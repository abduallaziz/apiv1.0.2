import { BadRequestException, ConflictException } from '@nestjs/common';
import { BranchesService } from './branches.service';

const tenant = { tenantId: 't1' } as never;

function make(overrides: Record<string, unknown> = {}) {
  const repo = {
    findById: jest.fn().mockResolvedValue({
      id: 'b1',
      name: 'Old',
      default_warehouse_id: 'w1',
    }),
    nameExists: jest.fn().mockResolvedValue(false),
    create: jest.fn().mockImplementation((_t, d) => d),
    update: jest.fn().mockResolvedValue({ id: 'b1' }),
    renameAutoWarehouse: jest.fn(),
    countActive: jest.fn().mockResolvedValue(3),
    hasOpenShift: jest.fn().mockResolvedValue(false),
    hasHistory: jest.fn().mockResolvedValue(false),
    softDelete: jest.fn(),
    warehouseBelongsToTenant: jest.fn(),
    warehouseHasStock: jest.fn().mockResolvedValue(false),
    softDeleteWarehouse: jest.fn(),
    ...overrides,
  };
  const billing = { checkBranchLimit: jest.fn() };
  const isolation = { invalidate: jest.fn() };
  return {
    repo: repo as Record<string, jest.Mock>,
    isolation,
    svc: new BranchesService(
      repo as never,
      billing as never,
      isolation as never,
    ),
  };
}

describe('BranchesService', () => {
  it('rejects duplicate names on create', async () => {
    const { svc } = make({ nameExists: jest.fn().mockResolvedValue(true) });
    await expect(svc.create({ name: 'X' }, tenant)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('rejects blank names on create', async () => {
    const { svc } = make();
    await expect(svc.create({ name: '  ' }, tenant)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it('renames the auto warehouse when the name changes', async () => {
    const { svc, repo } = make();
    await svc.update('b1', { name: 'New' }, tenant);
    expect(repo.renameAutoWarehouse).toHaveBeenCalledWith(
      tenant,
      'w1',
      'Old',
      'New',
    );
  });
  it('refuses deleting a branch with an open shift or history', async () => {
    await expect(
      make({ hasOpenShift: jest.fn().mockResolvedValue(true) }).svc.remove(
        'b1',
        tenant,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      make({ hasHistory: jest.fn().mockResolvedValue(true) }).svc.remove(
        'b1',
        tenant,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('refuses deleting the last branch', async () => {
    const { svc } = make({ countActive: jest.fn().mockResolvedValue(1) });
    await expect(svc.remove('b1', tenant)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it('deletes a clean branch', async () => {
    const { svc, repo } = make();
    await svc.remove('b1', tenant);
    expect(repo.softDelete).toHaveBeenCalled();
    expect(repo.softDeleteWarehouse).toHaveBeenCalledWith('w1', tenant);
  });
  it('keeps the warehouse when it still holds stock', async () => {
    const { svc, repo } = make({
      warehouseHasStock: jest.fn().mockResolvedValue(true),
    });
    await svc.remove('b1', tenant);
    expect(repo.softDelete).toHaveBeenCalled();
    expect(repo.softDeleteWarehouse).not.toHaveBeenCalled();
  });

  describe('branch isolation', () => {
    it('refuses to enable isolation without a main branch', async () => {
      const { svc, repo } = make({
        getIsolation: jest
          .fn()
          .mockResolvedValue({ enabled: false, main_branch_id: null }),
        setIsolation: jest.fn(),
      });
      await expect(svc.setIsolation(tenant, true)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.setIsolation).not.toHaveBeenCalled();
    });

    it('enables isolation and clears the cache when a main branch exists', async () => {
      const { svc, repo, isolation } = make({
        getIsolation: jest
          .fn()
          .mockResolvedValue({ enabled: false, main_branch_id: 'b1' }),
        setIsolation: jest.fn().mockResolvedValue(undefined),
      });
      await svc.setIsolation(tenant, true);
      expect(repo.setIsolation).toHaveBeenCalledWith('t1', true);
      expect(isolation.invalidate).toHaveBeenCalledWith('t1');
    });

    it('only an active branch can become main', async () => {
      const { svc, repo } = make({
        findById: jest.fn().mockResolvedValue({ id: 'b2', is_active: false }),
        setMainBranch: jest.fn(),
      });
      await expect(svc.setMain('b2', tenant)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.setMainBranch).not.toHaveBeenCalled();
    });
  });
});
