import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import * as jwt from 'jsonwebtoken';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const path = (req['path'] as string) ?? (req['url'] as string) ?? '';

    // /auth routes keep IP-based tracking
    if (path.startsWith('/auth')) {
      return (req['realIp'] as string) ?? 'unknown';
    }

    // This guard is registered as a global APP_GUARD, which NestJS runs
    // before controller-level guards — including JwtAuthGuard, the guard
    // that actually verifies the token and sets request.user. So req.user
    // is never populated yet at this point; reading it here always fell
    // through to the IP fallback below, meaning every tenant behind the
    // same IP (office network, CGNAT, VPN) silently shared one throttle
    // bucket instead of each tenant getting its own.
    //
    // Decode (not verify) the bearer token here just to read tenant_id for
    // the rate-limit key. This does not grant any access or trust the
    // token's authenticity — JwtAuthGuard still independently verifies the
    // signature afterward and rejects invalid/forged tokens before any
    // business logic runs. A forged token here can only ever misattribute
    // its own request's rate-limit accounting, never bypass authentication.
    const headers = req['headers'] as Record<string, string> | undefined;
    const authHeader = headers?.['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const decoded = jwt.decode(authHeader.slice(7)) as JwtPayload | null;
        if (decoded?.tenant_id) {
          return `tenant:${decoded.tenant_id}`;
        }
      } catch {
        // fall through to IP-based tracking below
      }
    }

    const user = req['user'] as JwtPayload | undefined;
    if (user?.tenant_id) {
      return `tenant:${user.tenant_id}`;
    }

    // Fall back to IP for unauthenticated non-auth requests
    return (req['realIp'] as string) ?? 'unknown';
  }
}
