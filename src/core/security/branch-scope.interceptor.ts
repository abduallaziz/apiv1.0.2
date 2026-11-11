import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import {
  BRANCH_SCOPED_KEY,
  BranchScopedOptions,
} from './branch-scoped.decorator';
import { BranchAuthorizationService } from './branch-authorization.service';
import { JwtPayload } from '../../shared/types/jwt-payload.type';
import { TenantContext } from '../tenant/tenant-context';

// Branch Domain Batch 1, B1 (Owner-approved) — the global half of the
// Hybrid Model. Registered once as APP_INTERCEPTOR (app.module.ts) so it
// runs on every request, but does real work only for handlers carrying
// @BranchScoped() metadata (checked first, cheap Reflector read) —
// branch-insensitive endpoints pay zero BranchAuthorizationService cost,
// per the approved performance requirement.
//
// Runs after JwtAuthGuard/TenantGuard (interceptors execute after guards
// in the Nest request lifecycle), so request.user and request.tenantContext
// are already populated by the time this reads them.
@Injectable()
export class BranchScopeInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly branchAuthorization: BranchAuthorizationService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const options = this.reflector.getAllAndOverride<
      BranchScopedOptions | undefined
    >(BRANCH_SCOPED_KEY, [context.getHandler(), context.getClass()]);

    if (!options) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<{
      user?: JwtPayload;
      tenantContext?: TenantContext;
      query: Record<string, unknown>;
      body: Record<string, unknown>;
      effectiveBranchId?: string | null;
    }>();

    const user = request.user;
    const tenantContext = request.tenantContext;

    // Both guards run before this interceptor and already reject an
    // unauthenticated/tenant-less request — these guards are defense in
    // depth against a route that somehow carries @BranchScoped() without
    // also carrying JwtAuthGuard/TenantGuard, not the primary check.
    if (!user || !tenantContext?.tenantId) {
      throw new ForbiddenException(
        'Branch scope requires an authenticated tenant context',
      );
    }

    const source = options.source === 'body' ? request.body : request.query;
    const rawBranchId = source?.branch_id;
    const requestedBranchId =
      typeof rawBranchId === 'string' && rawBranchId.length > 0
        ? rawBranchId
        : undefined;

    const result = await this.branchAuthorization.resolveBranchScope(
      {
        tenantId: tenantContext.tenantId,
        userId: user.sub,
        branchId: user.branch_id ?? null,
      },
      requestedBranchId,
      options.mode ?? 'read',
    );

    if (!result.allowed) {
      // strictNullChecks is off project-wide (see BranchAuthorizationService's
      // own doc comment) — `result` doesn't narrow to the `reason` branch
      // automatically even though it's correct at runtime.
      const { reason } = result as { reason: string };
      throw new ForbiddenException(
        reason === 'branch_mismatch'
          ? 'You are not authorized to access this branch.'
          : 'Branch not found or does not belong to tenant.',
      );
    }

    request.effectiveBranchId = result.effectiveBranchId;

    return next.handle();
  }
}
