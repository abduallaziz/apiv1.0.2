import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { BranchScopeInterceptor } from './branch-scope.interceptor';
import { BranchAuthorizationService } from './branch-authorization.service';
import { BranchValidatorService } from './branch-validator.service';
import { TenantContext } from '../tenant/tenant-context';

// Branch Domain Batch 1, B1 (Owner-approved) — the interceptor is
// exercised with a REAL BranchAuthorizationService (only its own
// BranchValidatorService dependency is stubbed) so these tests prove the
// full @BranchScoped() → interceptor → resolveBranchScope chain end to
// end, not just the interceptor's own glue code in isolation.
// BranchAuthorizationService.resolveBranchScope's own decision-table cases
// (1-10 here) are already unit-tested directly in
// branch-authorization.service.spec.ts — re-asserting them through the
// interceptor proves the wiring is correct, not the algorithm itself.

const TENANT_A = 'tenant-a';
const BRANCH_A1 = 'branch-a1';
const BRANCH_A2 = 'branch-a2';

function buildInterceptor(
  validateImpl: (branchId: string, tenantId: string) => Promise<void>,
) {
  const validator = {
    validate: jest.fn(validateImpl),
  } as unknown as BranchValidatorService;
  const branchAuth = new BranchAuthorizationService(validator);
  const reflector = new Reflector();
  return {
    interceptor: new BranchScopeInterceptor(reflector, branchAuth),
    reflector,
  };
}

const alwaysValid = () => Promise.resolve();
const alwaysInvalid = () =>
  Promise.reject(new Error('Branch not found or does not belong to tenant'));

function fakeContext(opts: {
  metadata?: { source?: 'query' | 'body'; mode?: 'read' | 'write' };
  user?: { sub: string; branch_id?: string | null };
  tenantId?: string | null;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}) {
  const request: Record<string, unknown> = {
    user: opts.user ?? { sub: 'user-1', branch_id: null },
    tenantContext:
      opts.tenantId === undefined
        ? new TenantContext(TENANT_A, null)
        : new TenantContext(opts.tenantId, null),
    query: opts.query ?? {},
    body: opts.body ?? {},
  };

  const handlerMeta = opts.metadata;
  const context = {
    getHandler: () => (handlerMeta ? markedHandler : plainHandler),
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  };

  function markedHandler() {}
  function plainHandler() {}
  if (handlerMeta) {
    Reflect.defineMetadata('branch_scoped', handlerMeta, markedHandler);
  }

  return { context: context as any, request };
}

const nextHandle = { handle: () => of('ok') };

describe('BranchScopeInterceptor', () => {
  it('11. branch-insensitive endpoint (no @BranchScoped metadata) never invokes BranchAuthorizationService', async () => {
    const { interceptor } = buildInterceptor(alwaysValid);
    const spy = jest.spyOn(
      BranchAuthorizationService.prototype,
      'resolveBranchScope',
    );
    const { context, request } = fakeContext({});

    await interceptor.intercept(context, nextHandle);

    expect(spy).not.toHaveBeenCalled();
    expect(request.effectiveBranchId).toBeUndefined();
    spy.mockRestore();
  });

  it('12. branch-scoped handler invokes resolution exactly once', async () => {
    const { interceptor } = buildInterceptor(alwaysValid);
    const spy = jest.spyOn(
      BranchAuthorizationService.prototype,
      'resolveBranchScope',
    );
    const { context } = fakeContext({ metadata: {} });

    await interceptor.intercept(context, nextHandle);

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('13. effective branch is attached to the request for Central + explicit branch', async () => {
    const { interceptor } = buildInterceptor(alwaysValid);
    const { context, request } = fakeContext({
      metadata: {},
      query: { branch_id: BRANCH_A1 },
    });

    await interceptor.intercept(context, nextHandle);

    expect(request.effectiveBranchId).toBe(BRANCH_A1);
  });

  it('13b. effective branch is null for Central + omitted branch (tenant-wide)', async () => {
    const { interceptor } = buildInterceptor(alwaysValid);
    const { context, request } = fakeContext({ metadata: {} });

    await interceptor.intercept(context, nextHandle);

    expect(request.effectiveBranchId).toBeNull();
  });

  it('14. Restricted actor requesting another branch cannot alter the effective scope — request is rejected outright, not silently rewritten', async () => {
    const { interceptor } = buildInterceptor(alwaysValid);
    const { context, request } = fakeContext({
      metadata: {},
      user: { sub: 'user-restricted', branch_id: BRANCH_A1 },
      query: { branch_id: BRANCH_A2 },
    });

    await expect(
      interceptor.intercept(context, nextHandle),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(request.effectiveBranchId).toBeUndefined();
  });

  it('1. Central + omitted branch → tenant-wide, allowed', async () => {
    const { interceptor } = buildInterceptor(alwaysValid);
    const { context, request } = fakeContext({ metadata: {} });
    await interceptor.intercept(context, nextHandle);
    expect(request.effectiveBranchId).toBeNull();
  });

  it('2. Central + explicit same-tenant branch → allowed, scoped', async () => {
    const { interceptor } = buildInterceptor(alwaysValid);
    const { context, request } = fakeContext({
      metadata: {},
      query: { branch_id: BRANCH_A1 },
    });
    await interceptor.intercept(context, nextHandle);
    expect(request.effectiveBranchId).toBe(BRANCH_A1);
  });

  it('3. Central + cross-tenant/invalid branch → rejected', async () => {
    const { interceptor } = buildInterceptor(alwaysInvalid);
    const { context } = fakeContext({
      metadata: {},
      query: { branch_id: 'branch-of-other-tenant' },
    });
    await expect(
      interceptor.intercept(context, nextHandle),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('4. Restricted + omitted branch → automatically scoped to own branch', async () => {
    const { interceptor } = buildInterceptor(alwaysValid);
    const { context, request } = fakeContext({
      metadata: {},
      user: { sub: 'user-restricted', branch_id: BRANCH_A1 },
    });
    await interceptor.intercept(context, nextHandle);
    expect(request.effectiveBranchId).toBe(BRANCH_A1);
  });

  it('5. Restricted + explicit own branch → allowed, scoped', async () => {
    const { interceptor } = buildInterceptor(alwaysValid);
    const { context, request } = fakeContext({
      metadata: {},
      user: { sub: 'user-restricted', branch_id: BRANCH_A1 },
      query: { branch_id: BRANCH_A1 },
    });
    await interceptor.intercept(context, nextHandle);
    expect(request.effectiveBranchId).toBe(BRANCH_A1);
  });

  it('6. Restricted + explicit other branch → rejected', async () => {
    const { interceptor } = buildInterceptor(alwaysValid);
    const { context } = fakeContext({
      metadata: {},
      user: { sub: 'user-restricted', branch_id: BRANCH_A1 },
      query: { branch_id: BRANCH_A2 },
    });
    await expect(
      interceptor.intercept(context, nextHandle),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('7. Restricted + cross-tenant branch → rejected', async () => {
    const { interceptor } = buildInterceptor(alwaysValid);
    const { context } = fakeContext({
      metadata: {},
      user: { sub: 'user-restricted', branch_id: BRANCH_A1 },
      query: { branch_id: 'branch-of-other-tenant' },
    });
    await expect(
      interceptor.intercept(context, nextHandle),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('8. inactive branch (validator throws) → rejected cleanly, not a raw 500', async () => {
    const { interceptor } = buildInterceptor(alwaysInvalid);
    const { context } = fakeContext({
      metadata: {},
      query: { branch_id: BRANCH_A1 },
    });
    await expect(
      interceptor.intercept(context, nextHandle),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("9. deleted branch (validator throws, same as inactive from this layer's view) → rejected cleanly", async () => {
    const { interceptor } = buildInterceptor(alwaysInvalid);
    const { context } = fakeContext({
      metadata: {},
      user: { sub: 'user-restricted', branch_id: BRANCH_A1 },
    });
    // Restricted actor's OWN branch has since been deleted — re-validated
    // as defense in depth even though nothing was explicitly requested.
    await expect(
      interceptor.intercept(context, nextHandle),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('10. malformed branch id → rejected cleanly (via BranchValidatorService catching the Postgres error), never an unhandled 500', async () => {
    const { interceptor } = buildInterceptor(alwaysInvalid);
    const { context } = fakeContext({
      metadata: {},
      query: { branch_id: 'not-a-uuid' },
    });
    await expect(
      interceptor.intercept(context, nextHandle),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reads the requested branch from the body when source is "body"', async () => {
    const { interceptor } = buildInterceptor(alwaysValid);
    const { context, request } = fakeContext({
      metadata: { source: 'body' },
      body: { branch_id: BRANCH_A1 },
      query: { branch_id: BRANCH_A2 }, // must be ignored — body is the declared source
    });
    await interceptor.intercept(context, nextHandle);
    expect(request.effectiveBranchId).toBe(BRANCH_A1);
  });

  it('rejects with no BranchAuthorizationService call when the request has no authenticated tenant context', async () => {
    const { interceptor } = buildInterceptor(alwaysValid);
    const spy = jest.spyOn(
      BranchAuthorizationService.prototype,
      'resolveBranchScope',
    );
    const { context } = fakeContext({ metadata: {}, tenantId: null });
    await expect(
      interceptor.intercept(context, nextHandle),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
