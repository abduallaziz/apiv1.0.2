import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const path = (req['path'] as string) ?? (req['url'] as string) ?? '';

    // /auth routes keep IP-based tracking
    if (path.startsWith('/auth')) {
      return (req['realIp'] as string) ?? 'unknown';
    }

    const user = req['user'] as JwtPayload | undefined;
    if (user?.tenant_id) {
      return `tenant:${user.tenant_id}`;
    }

    // Fall back to IP for unauthenticated non-auth requests
    return (req['realIp'] as string) ?? 'unknown';
  }
}
