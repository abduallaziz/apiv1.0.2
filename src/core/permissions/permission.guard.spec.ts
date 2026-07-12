import { ForbiddenException } from '@nestjs/common';
import { PermissionGuard } from './permission.guard';

function buildContext(user: any) {
  const request = { user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

function buildReflector(requiredPermission: string | undefined) {
  return { getAllAndOverride: () => requiredPermission } as any;
}

describe('PermissionGuard — Phase C shadow mode', () => {
  const TENANT_A = 'tenant-a';

  afterEach(() => {
    delete process.env.ENFORCE_HYBRID_PERMISSIONS;
  });

  it('superadmin bypasses everything without ever calling PermissionsService', async () => {
    const permissionsService = {
      hasPermission: jest.fn(),
      hasPermissionForUser: jest.fn(),
    };
    const guard = new PermissionGuard(buildReflector('expenses.view'), permissionsService as any);
    const context = buildContext({ sub: 'u1', role: 'superadmin', roles: ['superadmin'], tenant_id: TENANT_A });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(permissionsService.hasPermission).not.toHaveBeenCalled();
    expect(permissionsService.hasPermissionForUser).not.toHaveBeenCalled();
  });

  it('owner is granted by both legacy and hybrid paths — no divergence, still enforced via legacy in shadow mode', async () => {
    const permissionsService = {
      hasPermission: jest.fn().mockResolvedValue(true),
      hasPermissionForUser: jest.fn().mockResolvedValue(true),
    };
    const guard = new PermissionGuard(buildReflector('expenses.view'), permissionsService as any);
    const loggerWarnSpy = jest.spyOn((guard as any).logger, 'warn');
    const context = buildContext({ sub: 'owner-1', role: 'owner', roles: ['owner'], tenant_id: TENANT_A });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(permissionsService.hasPermission).toHaveBeenCalledWith('owner', 'expenses.view', TENANT_A);
    expect(permissionsService.hasPermissionForUser).toHaveBeenCalledWith('owner-1', 'expenses.view', TENANT_A);
    expect(loggerWarnSpy).not.toHaveBeenCalled();
  });

  it('logs a divergence warning but still enforces the LEGACY result while ENFORCE_HYBRID_PERMISSIONS is unset', async () => {
    const permissionsService = {
      hasPermission: jest.fn().mockResolvedValue(true), // legacy says granted
      hasPermissionForUser: jest.fn().mockResolvedValue(false), // hybrid disagrees
    };
    const guard = new PermissionGuard(buildReflector('expenses.approve'), permissionsService as any);
    const loggerWarnSpy = jest.spyOn((guard as any).logger, 'warn').mockImplementation(() => {});
    const context = buildContext({ sub: 'u2', role: 'manager', roles: ['manager'], tenant_id: TENANT_A });

    // Legacy grants -> guard allows the request even though hybrid would deny it.
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('[ShadowMode] Permission divergence'));
  });

  it('enforces the HYBRID result once ENFORCE_HYBRID_PERMISSIONS=true', async () => {
    process.env.ENFORCE_HYBRID_PERMISSIONS = 'true';
    const permissionsService = {
      hasPermission: jest.fn().mockResolvedValue(true), // legacy would grant
      hasPermissionForUser: jest.fn().mockResolvedValue(false), // hybrid denies
    };
    const guard = new PermissionGuard(buildReflector('expenses.approve'), permissionsService as any);
    const context = buildContext({ sub: 'u3', role: 'manager', roles: ['manager'], tenant_id: TENANT_A });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('a thrown error inside hasPermissionForUser never breaks real enforcement (falls back to legacy, no crash)', async () => {
    const permissionsService = {
      hasPermission: jest.fn().mockResolvedValue(true),
      hasPermissionForUser: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const guard = new PermissionGuard(buildReflector('expenses.view'), permissionsService as any);
    const loggerErrorSpy = jest.spyOn((guard as any).logger, 'error').mockImplementation(() => {});
    const context = buildContext({ sub: 'u4', role: 'manager', roles: ['manager'], tenant_id: TENANT_A });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(loggerErrorSpy).toHaveBeenCalled();
  });
});
