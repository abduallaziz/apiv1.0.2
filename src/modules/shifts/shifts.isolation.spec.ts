import { BadRequestException } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { TenantContext } from '../../core/tenant/tenant.context';

function build() {
  const repo = {
    findAll: jest.fn().mockResolvedValue([]),
    findOpenByUser: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
  };
  const service = new ShiftsService(
    repo as never,
    { validateNoDoubleShift: jest.fn() } as never,
    { log: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, repo };
}

describe('ShiftsService branch isolation', () => {
  it('lists the context branch regardless of the requested one when isolated', async () => {
    const { service, repo } = build();
    await service.findAll(new TenantContext('t1', 'b2', true), 'b9');
    expect(repo.findAll).toHaveBeenCalledWith('t1', 'b2');
  });

  it('keeps the requested filter when not isolated', async () => {
    const { service, repo } = build();
    await service.findAll(new TenantContext('t1', 'b2'), 'b9');
    expect(repo.findAll).toHaveBeenCalledWith('t1', 'b9');
  });

  it('refuses to open a shift outside the working branch', async () => {
    const { service, repo } = build();
    await expect(
      service.openShift({ branch_id: 'b9', opening_cash: 0 } as never, new TenantContext('t1', 'b2', true), 'u1', 'cashier', '', ''),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('ShiftsService per-branch register', () => {
  it('isolated: current/open look only at the working branch', async () => {
    const { service, repo } = build();
    await service.getCurrentShift(new TenantContext('t1', 'b2', true), 'u1');
    expect(repo.findOpenByUser).toHaveBeenCalledWith('u1', 't1', 'b2');
  });
  it('not isolated: tenant-wide lookup as before', async () => {
    const { service, repo } = build();
    await service.getCurrentShift(new TenantContext('t1', 'b2'), 'u1');
    expect(repo.findOpenByUser).toHaveBeenCalledWith('u1', 't1', undefined);
  });
});
