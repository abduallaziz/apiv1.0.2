import { BadRequestException } from '@nestjs/common';
import { AccessControlService } from './access-control.service';
import { AccessControlRepository } from './access-control.repository';
import { PermissionsService } from '../../core/permissions/permissions.service';
import { AuditService } from '../../core/audit/audit.service';
import { TenantContext } from '../../core/tenant/tenant-context';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

const ZWSP = String.fromCharCode(0x200b); // zero-width space
const ZWJ = String.fromCharCode(0x200d); // zero-width joiner
const SHY = String.fromCharCode(0xad); // soft hyphen

/**
 * R-01 — a tenant must never be able to mint a role whose name collides with
 * a system / reserved role. These tests fail on the pre-fix service, which
 * only trimmed the name.
 */
const TENANT_A = 'tenant-a';

const owner: JwtPayload = {
  sub: 'u-owner',
  email: 'o@a.test',
  role: 'owner',
  roles: ['owner'],
  tenant_id: TENANT_A,
  session_id: 's1',
  business_type: null,
  activity: null,
};

function build(
  systemNames: string[] = [
    'superadmin',
    'owner',
    'manager',
    'cashier',
    'worker',
    'inventory_clerk',
    'none',
  ],
) {
  const repo = {
    createRole: jest.fn(
      async (tenantId: string, name: string, description: string | null) => ({
        id: 'role-new',
        name,
        description,
        tenant_id: tenantId,
        is_system: false,
        created_at: 'x',
        updated_at: 'x',
      }),
    ),
    listSystemRoleNames: jest.fn().mockResolvedValue(systemNames),
  } as unknown as AccessControlRepository;
  const audit = {
    log: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  const service = new AccessControlService(
    repo,
    {} as PermissionsService,
    audit,
  );
  return { service, repo };
}

const tenant = new TenantContext(TENANT_A, null);

describe('AccessControlService.createRole — reserved names (R-01)', () => {
  it.each([
    'superadmin',
    'SuperAdmin',
    ' super admin ',
    'super_admin',
    'super-admin',
    'ｓｕｐｅｒａｄｍｉｎ',
    `super${ZWSP}admin`,
    'sυperadmin',
    'owner',
    'OWNER',
    'оwner',
    'manager',
    'Cashier',
    'worker',
    'inventory clerk',
    'none',
    'admin',
    'platform',
  ])('rejects the reserved name %j', async (name) => {
    const { service, repo } = build();
    await expect(
      service.createRole(name, null, tenant, owner),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.createRole).not.toHaveBeenCalled();
  });

  it('rejects a name that normalises to nothing', async () => {
    const { service, repo } = build();
    await expect(
      service.createRole(`${ZWSP}${ZWJ}`, null, tenant, owner),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.createRole).not.toHaveBeenCalled();
  });

  it('rejects a name that equals a global role added later (live list)', async () => {
    const { service, repo } = build(['superadmin', 'franchise_admin']);
    await expect(
      service.createRole('Franchise Admin', null, tenant, owner),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.createRole).not.toHaveBeenCalled();
  });

  it('fails closed when the live list cannot be read', async () => {
    const { service, repo } = build();
    (repo.listSystemRoleNames as jest.Mock).mockRejectedValue(
      new Error('db down'),
    );
    await expect(
      service.createRole('Supervisor', null, tenant, owner),
    ).rejects.toThrow('db down');
    expect(repo.createRole).not.toHaveBeenCalled();
  });

  it.each([
    'Supervisor',
    'Shift Lead',
    'Accountant',
    'Cashier Trainee',
    'مشرف الوردية',
  ])('still creates the legitimate custom role %j', async (name) => {
    const { service, repo } = build();
    const role = await service.createRole(name, 'desc', tenant, owner);
    expect(role.name).toBe(name);
    expect(repo.createRole).toHaveBeenCalledWith(TENANT_A, name, 'desc');
  });
});
