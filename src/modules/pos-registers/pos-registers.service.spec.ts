import { BadRequestException, ConflictException } from '@nestjs/common';
import { PosRegistersService } from './pos-registers.service';
import { TenantContext } from '../../core/tenant/tenant.context';

const TENANT = new TenantContext('t1', null);

function make(overrides: Record<string, jest.Mock> = {}, billing: Record<string, jest.Mock> = {}) {
  const repo = {
    listByBranch: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue({ id: 'r1', branch_id: 'b1', is_active: true }),
    create: jest.fn().mockImplementation((_t, d) => ({ id: 'rNew', ...d })),
    update: jest.fn().mockImplementation((_t, id, p) => ({ id, ...p })),
    softDelete: jest.fn(),
    hasOpenShift: jest.fn().mockResolvedValue(false),
    ...overrides,
  };
  const bill = { checkPosLimit: jest.fn().mockResolvedValue(undefined), ...billing };
  return { repo, svc: new PosRegistersService(repo as never, bill as never), bill };
}

describe('PosRegistersService', () => {
  it('checks the POS pool before creating a register', async () => {
    const { svc, bill } = make();
    await svc.create({ branch_id: 'b1', name: 'صندوق 1' }, TENANT);
    expect(bill.checkPosLimit).toHaveBeenCalledWith('t1');
  });

  it('rejects a register beyond the pool', async () => {
    const { svc } = make({}, {
      checkPosLimit: jest.fn().mockRejectedValue(new ConflictException('POS limit reached')),
    });
    await expect(svc.create({ branch_id: 'b1', name: 'x' }, TENANT)).rejects.toBeInstanceOf(ConflictException);
  });

  it('a restricted user cannot add a register to another branch', async () => {
    const { svc } = make();
    await expect(
      svc.create({ branch_id: 'other', name: 'x' }, new TenantContext('t1', 'b1', true)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to deactivate a register with an open shift', async () => {
    const { svc } = make({ hasOpenShift: jest.fn().mockResolvedValue(true) });
    await expect(svc.update('r1', { is_active: false }, TENANT)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to delete a register with an open shift', async () => {
    const { svc } = make({ hasOpenShift: jest.fn().mockResolvedValue(true) });
    await expect(svc.remove('r1', TENANT)).rejects.toBeInstanceOf(ConflictException);
  });

  describe('resolveForOpen', () => {
    it('auto-resolves the single active register of a branch', async () => {
      const { svc } = make({ listByBranch: jest.fn().mockResolvedValue([{ id: 'only', is_active: true }]) });
      await expect(svc.resolveForOpen(TENANT, 'b1')).resolves.toBe('only');
    });

    it('requires a choice when the branch has several registers', async () => {
      const { svc } = make({
        listByBranch: jest.fn().mockResolvedValue([
          { id: 'a', is_active: true },
          { id: 'b', is_active: true },
        ]),
      });
      await expect(svc.resolveForOpen(TENANT, 'b1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a valid chosen register', async () => {
      const { svc } = make({
        listByBranch: jest.fn().mockResolvedValue([
          { id: 'a', is_active: true },
          { id: 'b', is_active: true },
        ]),
      });
      await expect(svc.resolveForOpen(TENANT, 'b1', 'b')).resolves.toBe('b');
    });

    it('rejects a register not in the branch', async () => {
      const { svc } = make({ listByBranch: jest.fn().mockResolvedValue([{ id: 'a', is_active: true }]) });
      await expect(svc.resolveForOpen(TENANT, 'b1', 'zzz')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
