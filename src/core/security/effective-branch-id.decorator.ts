import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Branch Domain Batch 1, B1 (Owner-approved) — reads the server-authoritative
// scope BranchScopeInterceptor already resolved and attached to the request.
// Only meaningful on a handler also carrying @BranchScoped() — on any other
// route this is simply undefined, since the interceptor never ran its
// resolution logic for it. `null` (as opposed to undefined) specifically
// means "Central actor, tenant-wide" — the same effectiveBranchId contract
// BranchAuthorizationService.resolveBranchScope already documents.
export const EffectiveBranchId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.effectiveBranchId;
  },
);
