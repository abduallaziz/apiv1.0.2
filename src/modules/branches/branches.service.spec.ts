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
    ...overrides,
  };
  const billing = { checkBranchLimit: jest.fn() };
  return {
    repo,
    svc: new BranchesService(repo as never, billing as never),
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
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      make({ hasHistory: jest.fn().mockResolvedValue(true) }).svc.remove(
        'b1',
        tenant,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
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
  });
});
