import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtPayload } from '../../shared/types/jwt-payload.type';
import { decodeTenantId } from './decode-tenant.util';
import { isLoadTestMode } from './load-test-mode';
import { isQaTenant } from './qa-tenant';

// QA/demo tenant exemption: see qa-tenant.ts (non-production only, and only
// for a signature-verified tenant id).
@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    // Temporary load-testing bypass — see load-test-mode.ts. Defaults to off,
    // so this returns false and behaviour is unchanged unless the flag is
    // explicitly set to 'true'.
    //
    // ThrottlerGuard.canActivate() checks shouldSkip() before iterating the
    // named throttlers, so one early exit here covers 'global', 'global-ip',
    // 'auth' and 'session' together. No limit is modified — the buckets are
    // simply never consulted while the flag is on.
    if (isLoadTestMode()) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const tenantId = decodeTenantId(req);
    // Exemption only for a signature-verified QA tenant, and never in
    // production (decodeTenantId verifies; isQaTenant checks NODE_ENV).
    return isQaTenant(tenantId);
  }

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
    const tenantId = decodeTenantId(req);
    if (tenantId) {
      return `tenant:${tenantId}`;
    }

    const user = req['user'] as JwtPayload | undefined;
    if (user?.tenant_id) {
      return `tenant:${user.tenant_id}`;
    }

    // Fall back to IP for unauthenticated non-auth requests
    return (req['realIp'] as string) ?? 'unknown';
  }
}
