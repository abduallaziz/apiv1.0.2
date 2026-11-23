import { ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { TenantContext } from '../../core/tenant/tenant.context';
import { JwtPayload } from '../../shared/types/jwt-payload.type';
import { UserRole } from '../../shared/types/enums';

/**
 * R-01 / P1-D2 — who may grant which role through the tenant-facing API.
 * A users.manage holder who is not the tenant owner must not be able to mint
 * an owner, and nobody can grant the platform role or a reserved look-alike.
 */
const TENANT = 'tenant-a';
const tenant = new TenantContext(TENANT, null);

const actorOf = (
  role: string,
  extra: Partial<JwtPayload> = {},
): JwtPayload => ({
  sub: 'actor-1',
  email: 'a@a.test',
  role,
  roles: [role],
  tenant_id: TENANT,
  session_id: 's1',
  business_type: null,
  activity: null,
  ...extra,
});
const owner = actorOf('owner');
const manager = actorOf('manager');
const platform = actorOf('superadmin', {
  tenant_id: null,
  platform_admin: true,
});

function build(
  role: { id: string; tenant_id: string | null; name: string } | null,
) {
  const repo = {
    findOne: jest.fn(),
    findByEmail: jest.fn().mockResolvedValue({ data: null }),
    findSystemRoleId: jest.fn().mockResolvedValue('sys-role-id'),
    findAccessibleRole: jest.fn().mockResolvedValue(role),
    countUserRoles: jest.fn().mockResolvedValue(1),
    insertUserRole: jest.fn().mockResolvedValue(undefined),
    syncPrimaryRole: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue({ data: {}, error: null }),
    create: jest
      .fn()
      .mockResolvedValue({
        data: { id: 'new', email: 'x', role: 'owner' },
        error: null,
      }),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const billing = { checkUserLimit: jest.fn().mockResolvedValue(undefined) };
  const permissions = {
    invalidateUserPermissions: jest.fn().mockResolvedValue(undefined),
  };
  const service = new UsersService(
    repo as never,
    audit as never,
    billing as never,
    {} as never,
    permissions as never,
    {} as never,
  );
  // findOne is exercised elsewhere; here the target user always exists in the tenant
  jest
    .spyOn(service, 'findOne')
    .mockResolvedValue({ id: 'target', role: 'cashier' } as never);
  return { service, repo };
}

describe('UsersService.addRole — grant rules (R-01)', () => {
  it('never grants the platform role, even to a platform admin acting in a tenant', async () => {
    for (const actor of [owner, manager, platform]) {
      const { service, repo } = build({
        id: 'r',
        tenant_id: null,
        name: 'superadmin',
      });
      await expect(
        service.addRole('target', 'r', tenant, 'actor-1', actor),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.insertUserRole).not.toHaveBeenCalled();
    }
  });

  it('rejects a tenant-scoped look-alike role (superadmin / owner / manager names)', async () => {
    for (const name of [
      'superadmin',
      'Owner',
      'manager',
      'cashier',
      'ѕuperadmin',
    ]) {
      const { service, repo } = build({ id: 'r', tenant_id: TENANT, name });
      await expect(
        service.addRole('target', 'r', tenant, 'actor-1', owner),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.insertUserRole).not.toHaveBeenCalled();
    }
  });

  it('a users.manage manager cannot grant the system owner role (no self/other promotion)', async () => {
    const { service, repo } = build({
      id: 'r',
      tenant_id: null,
      name: 'owner',
    });
    await expect(
      service.addRole('actor-1', 'r', tenant, 'actor-1', manager),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.addRole('target', 'r', tenant, 'actor-1', undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.insertUserRole).not.toHaveBeenCalled();
  });

  it('the tenant owner and the platform admin may grant owner', async () => {
    for (const actor of [owner, platform]) {
      const { service, repo } = build({
        id: 'r',
        tenant_id: null,
        name: 'owner',
      });
      await expect(
        service.addRole('target', 'r', tenant, 'actor-1', actor),
      ).resolves.toMatchObject({ role_name: 'owner' });
      expect(repo.insertUserRole).toHaveBeenCalled();
    }
  });

  it('non-sensitive roles keep working for a manager (cashier, system manager, custom)', async () => {
    for (const r of [
      { id: 'r1', tenant_id: null, name: 'cashier' },
      { id: 'r2', tenant_id: null, name: 'manager' },
      { id: 'r3', tenant_id: TENANT, name: 'Supervisor' },
    ]) {
      const { service, repo } = build(r);
      await expect(
        service.addRole('target', r.id, tenant, 'actor-1', manager),
      ).resolves.toMatchObject({ role_name: r.name });
      expect(repo.insertUserRole).toHaveBeenCalled();
    }
  });
});

describe('UsersService.changeRole / create — owner promotion (R-01)', () => {
  it('changeRole to owner is refused for a manager and allowed for the owner', async () => {
    const a = build(null);
    await expect(
      a.service.changeRole(
        'target',
        { role: UserRole.OWNER } as never,
        tenant,
        'actor-1',
        manager,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(a.repo.update).not.toHaveBeenCalled();

    const b = build(null);
    await expect(
      b.service.changeRole(
        'target',
        { role: UserRole.OWNER } as never,
        tenant,
        'actor-1',
        owner,
      ),
    ).resolves.toBeDefined();
  });

  it('changeRole to superadmin is refused for everyone', async () => {
    for (const actor of [owner, platform]) {
      const { service } = build(null);
      await expect(
        service.changeRole(
          'target',
          { role: UserRole.SUPERADMIN } as never,
          tenant,
          'actor-1',
          actor,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('demoting an owner is also owner-only', async () => {
    const { service, repo } = build(null);
    (service.findOne as jest.Mock).mockResolvedValue({
      id: 'target',
      role: 'owner',
    });
    await expect(
      service.changeRole(
        'target',
        { role: UserRole.CASHIER } as never,
        tenant,
        'actor-1',
        manager,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('create with role owner is refused for a manager and allowed for the owner', async () => {
    const dto = {
      email: 'n@a.test',
      name: 'N',
      password: 'password123',
      role: UserRole.OWNER,
    } as never;
    const a = build(null);
    await expect(
      a.service.create(dto, tenant, 'actor-1', manager),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(a.repo.create).not.toHaveBeenCalled();
    const b = build(null);
    await expect(
      b.service.create(dto, tenant, 'actor-1', owner),
    ).resolves.toBeDefined();
  });
});
