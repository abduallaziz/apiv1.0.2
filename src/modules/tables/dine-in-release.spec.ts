import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DineInService } from './dine-in.service';

describe('DineInService.releaseTable', () => {
  const tenant = { tenantId: 't1' } as never;
  const mk = (
    result: string,
    table: unknown = { id: 'x', branch_id: 'b1' },
  ) => {
    const dineInRepo = {
      releaseEmptyTable: jest.fn().mockResolvedValue(result),
    };
    const tablesRepo = { findById: jest.fn().mockResolvedValue(table) };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const svc = new DineInService(
      tablesRepo as never,
      dineInRepo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      audit as never,
      {} as never,
    );
    return { svc, audit };
  };

  it('frees an empty table and audits it', async () => {
    const { svc, audit } = mk('released');
    await expect(svc.releaseTable(tenant, 'x', 'u1', 'owner')).resolves.toEqual(
      {
        table_id: 'x',
        status: 'available',
      },
    );
    expect(audit.log).toHaveBeenCalled();
  });
  it('refuses when items were ordered', async () => {
    const { svc, audit } = mk('has_items');
    await expect(
      svc.releaseTable(tenant, 'x', 'u1', 'owner'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(audit.log).not.toHaveBeenCalled();
  });
  it('404s without an open order or an unknown table', async () => {
    await expect(
      mk('no_open_order').svc.releaseTable(tenant, 'x', 'u1', 'o'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      mk('released', null).svc.releaseTable(tenant, 'x', 'u1', 'o'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
