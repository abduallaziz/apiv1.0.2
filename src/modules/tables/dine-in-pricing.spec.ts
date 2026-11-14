import { NotFoundException } from '@nestjs/common';
import { DineInService } from './dine-in.service';

describe('DineInService.addItems — server-side pricing (P1)', () => {
  const tenant = { tenantId: 't1' } as never;
  const mk = (official: number | null) => {
    const dineInRepo = {
      findOpenOrderByTable: jest.fn().mockResolvedValue({ id: 'o1' }),
      insertItems: jest.fn().mockResolvedValue(undefined),
    };
    const pricing = {
      getOfficialUnitPrice: jest.fn().mockResolvedValue(official),
    };
    const svc = new DineInService(
      {} as never,
      dineInRepo as never,
      {} as never,
      {} as never,
      {} as never,
      { getTaxRate: jest.fn().mockResolvedValue(15) } as never,
      {} as never,
      pricing as never,
    );
    jest
      .spyOn(svc as never, 'recalculateAndRespond' as never)
      .mockResolvedValue({ ok: true } as never);
    return { svc, dineInRepo, pricing };
  };
  const dto = (price: number) =>
    ({
      items: [
        { item_id: 'i1', item_name: 'x', quantity: 2, unit_price: price },
      ],
    }) as never;

  it('ignores a tampered client price and stores the official one', async () => {
    const { svc, dineInRepo } = mk(25);
    await svc.addItems(tenant, 'tbl', dto(0.01));
    const rows = (
      dineInRepo.insertItems.mock.calls as [
        string,
        string,
        { unit_price: number }[],
      ][]
    )[0][2];
    expect(rows[0].unit_price).toBe(25);
  });

  it('rejects an unknown/inactive item without inserting anything', async () => {
    const { svc, dineInRepo } = mk(null);
    await expect(svc.addItems(tenant, 'tbl', dto(5))).rejects.toThrow(
      NotFoundException,
    );
    expect(dineInRepo.insertItems).not.toHaveBeenCalled();
  });
});
