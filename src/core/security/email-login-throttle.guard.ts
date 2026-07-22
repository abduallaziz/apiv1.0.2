import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../cache/redis-client.token';

const WINDOW_MS = 60000;
const MAX_ATTEMPTS_PER_EMAIL = 5;

// Deliberately separate from the generic named-throttler system (ThrottlerModule)
// rather than registered as another named bucket there. A globally-registered
// named throttler applies to every route in the app by default (see
// TenantThrottlerGuard) — making it apply ONLY to login/register without
// accidentally throttling every other endpoint in the app by a shared
// "no email in this request" fallback key would require fighting
// @SkipThrottle semantics across every other controller. A small dedicated
// guard, applied only where it's actually used, is simpler to reason about
// and verify correct.
//
// Why this exists at all: the IP-based 'auth' bucket (throttler.config.ts)
// protects against brute-forcing from one IP, but is necessarily generous
// (30/min) to accommodate several real cashiers logging in from the same
// shop network within the same minute. That headroom alone would let an
// attacker who knows/guesses one specific victim's email try up to 30
// passwords/minute against that one account. This guard closes that gap:
// no single email can be attempted more than 5 times/minute, regardless of
// how much IP-level headroom exists.
@Injectable()
export class EmailLoginThrottleGuard implements CanActivate {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<{ body?: { email?: unknown } }>();
    const email =
      typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : null;

    // No email present — let the DTO's own validation (@IsEmail etc.) reject
    // the request with a normal 400; nothing to throttle by here.
    if (!email) return true;

    const key = `throttle:login-email:${email}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.pexpire(key, WINDOW_MS);
    }

    if (count > MAX_ATTEMPTS_PER_EMAIL) {
      throw new ThrottlerException();
    }

    return true;
  }
}
