import { ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantGuard } from '../tenant/tenant.guard';
import { SuperAdminGuard } from '../../modules/superadmin/guards/superadmin.guard';
import { AccessControlAdminGuard } from '../../modules/access-control/guards/access-control-admin.guard';
import { TenantOwnerGuard } from '../../modules/subscriptions/guards/tenant-owner.guard';
import { FeatureGuard } from '../feature-flags/feature.guard';
import { resolveUserPermission } from '../permissions/permission-resolution.util';
import { PlansController } from '../../modules/plans/plans.controller';

/**
 * R-01 — every administrative entry point must decide "platform" / "owner"
 * from a trusted identity, not from a role name a tenant could have created.
 * Each test presents a token the way the VERIFIED jwt would deliver it (the
 * signature is valid; the CLAIMS are what a tenant owner could have forged by
 * creating a tenant role named "superadmin").
 */
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const forgedTenantOwner = {
  sub: 'u-evil',
  email: 'evil@a.test',
  role: 'owner',
  roles: ['owner', 'superadmin'], // look-alike minted by a tenant role (old token shape)
  tenant_id: TENANT_A,
};
const forgedTenantOwnerWithClaim = {
  ...forgedTenantOwner,
  platform_admin: true,
};
const realPlatformAdmin = {
  sub: 'u-platform',
  email: 'root@platform.test',
  role: 'superadmin',
  roles: ['superadmin'],
  platform_admin: true,
  tenant_id: null,
};
const legacyPlatformAdminToken = {
  sub: 'u-platform',
  email: 'root@platform.test',
  role: 'superadmin',
  roles: ['superadmin'],
  tenant_id: null,
}; // issued before the platform_admin claim existed
const legitOwner = {
  sub: 'u-owner',
  email: 'o@a.test',
  role: 'owner',
  roles: ['owner'],
  tenant_id: TENANT_A,
};
const legitManager = {
  sub: 'u-mgr',
  email: 'm@a.test',
  role: 'manager',
  roles: ['manager'],
  tenant_id: TENANT_A,
};

function ctx(
  user: unknown,
  headers: Record<string, string> = {},
  extra: Record<string, unknown> = {},
) {
  const request: Record<string, unknown> = { user, headers, ...extra };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext,
  };
}

function tenantGuard() {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
  } as unknown as Reflector;
  const validator = { validate: jest.fn().mockResolvedValue(undefined) };
  const isolation = {
    get: jest.fn().mockResolvedValue({ enabled: false, mainBranchId: null }),
    isActiveBranch: jest.fn().mockResolvedValue(true),
  };
  const entitlements = { assertAccess: jest.fn().mockResolvedValue(undefined) };
  return new TenantGuard(
    reflector,
    validator as never,
    isolation as never,
    entitlements as never,
  );
}

describe('R-01 — TenantGuard', () => {
  it('a forged superadmin NAME in a tenant token does not unlock x-tenant-id switching', async () => {
    const { context, request } = ctx(forgedTenantOwner, {
      'x-tenant-id': TENANT_B,
    });
    await tenantGuard().canActivate(context);
    expect((request.tenantContext as { tenantId: string }).tenantId).toBe(
      TENANT_A,
    );
  });

  it('a forged platform_admin claim on a tenant token is ignored as well', async () => {
    const { context, request } = ctx(forgedTenantOwnerWithClaim, {
      'x-tenant-id': TENANT_B,
    });
    await tenantGuard().canActivate(context);
    expect((request.tenantContext as { tenantId: string }).tenantId).toBe(
      TENANT_A,
    );
  });

  it('the real platform admin can still select any tenant (new and legacy tokens)', async () => {
    for (const user of [realPlatformAdmin, legacyPlatformAdminToken]) {
      const { context, request } = ctx(user, { 'x-tenant-id': TENANT_B });
      await tenantGuard().canActivate(context);
      expect((request.tenantContext as { tenantId: string }).tenantId).toBe(
        TENANT_B,
      );
    }
  });

  it('a tenant-less token without platform identity is rejected', async () => {
    const { context } = ctx({
      sub: 'x',
      role: 'cashier',
      roles: ['cashier'],
      tenant_id: null,
    });
    await expect(tenantGuard().canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('R-01 — SuperAdminGuard', () => {
  const guard = new SuperAdminGuard();
  it.each([
    ['tenant owner with forged superadmin name', forgedTenantOwner],
    ['tenant owner with forged platform claim', forgedTenantOwnerWithClaim],
    ['legit owner', legitOwner],
    ['manager', legitManager],
  ])('rejects %s', (_label, user) => {
    expect(() => guard.canActivate(ctx(user).context)).toThrow(
      ForbiddenException,
    );
  });
  it.each([
    ['platform admin', realPlatformAdmin],
    ['platform admin with a pre-change token', legacyPlatformAdminToken],
  ])('accepts %s', (_label, user) => {
    expect(guard.canActivate(ctx(user).context)).toBe(true);
  });
  it('rejects when there is no user at all', () => {
    expect(() => guard.canActivate(ctx(undefined).context)).toThrow(
      ForbiddenException,
    );
  });
});

describe('R-01 — AccessControlAdminGuard / TenantOwnerGuard', () => {
  const adminGuard = new AccessControlAdminGuard();
  const ownerGuard = new TenantOwnerGuard();

  it('accept the real owner and the real platform admin', () => {
    for (const u of [legitOwner, realPlatformAdmin, legacyPlatformAdminToken]) {
      expect(adminGuard.canActivate(ctx(u).context)).toBe(true);
      expect(ownerGuard.canActivate(ctx(u).context)).toBe(true);
    }
  });

  it('reject a manager and a cashier (legit roles keep their limits)', () => {
    for (const u of [
      legitManager,
      { ...legitManager, role: 'cashier', roles: ['cashier'] },
    ]) {
      expect(() => adminGuard.canActivate(ctx(u).context)).toThrow(
        ForbiddenException,
      );
      expect(() => ownerGuard.canActivate(ctx(u).context)).toThrow(
        ForbiddenException,
      );
    }
  });

  it('reject a tenant token whose only privilege is a forged "superadmin" name', () => {
    const forged = { ...legitManager, roles: ['manager', 'superadmin'] };
    expect(() => adminGuard.canActivate(ctx(forged).context)).toThrow(
      ForbiddenException,
    );
    expect(() => ownerGuard.canActivate(ctx(forged).context)).toThrow(
      ForbiddenException,
    );
  });
});

describe('R-01 — FeatureGuard', () => {
  function featureGuard(enforced = true, features: string[] = []) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue('pos.advanced'),
    } as unknown as Reflector;
    const entitlements = {
      get: jest.fn().mockResolvedValue({ enforced, features }),
    };
    return new FeatureGuard(reflector, entitlements as never);
  }

  it('does not let a tenant user bypass feature gating by naming a role/legacy value superadmin', async () => {
    const user = { ...forgedTenantOwner, role: 'superadmin' };
    const { context } = ctx(
      user,
      {},
      { tenantContext: { tenantId: TENANT_A } },
    );
    await expect(featureGuard().canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lets the real platform admin through', async () => {
    const { context } = ctx(
      realPlatformAdmin,
      {},
      { tenantContext: { tenantId: TENANT_A } },
    );
    await expect(featureGuard().canActivate(context)).resolves.toBe(true);
  });
});

describe('R-01 — permission resolution bypass', () => {
  const permissions = {
    hasPermission: jest.fn().mockResolvedValue(false),
    hasPermissionForUser: jest.fn().mockResolvedValue(false),
  };
  const logger = new Logger('test');

  beforeEach(() => jest.clearAllMocks());

  it('forged superadmin name on a tenant token does not bypass permission checks', async () => {
    const ok = await resolveUserPermission(
      permissions as never,
      logger,
      forgedTenantOwner as never,
      'superadmin.tenants.manage',
    );
    expect(ok).toBe(false);
  });

  it('platform admin bypass still works', async () => {
    const ok = await resolveUserPermission(
      permissions as never,
      logger,
      realPlatformAdmin as never,
      'superadmin.tenants.manage',
    );
    expect(ok).toBe(true);
  });
});

describe('R-01 — PlansController inactive-plan visibility', () => {
  const plansService = {
    findAll: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
  };
  const controller = new PlansController(plansService as never);

  beforeEach(() => jest.clearAllMocks());

  it('a forged superadmin name does not reveal deactivated plans', async () => {
    await controller.findAll({ user: forgedTenantOwner } as never);
    expect(plansService.findAll).toHaveBeenCalledWith(false);
  });

  it('the platform admin sees them', async () => {
    await controller.findAll({ user: realPlatformAdmin } as never);
    expect(plansService.findAll).toHaveBeenCalledWith(true);
  });
});
