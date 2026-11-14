import { BadRequestException } from '@nestjs/common';
import { DineInService } from './dine-in.service';

describe('DineInService.checkout customer ownership (P1 isolation)', () => {
  const tenant = { tenantId: 't1' } as never;
  const mk = (customerOk: boolean) => {
    const dineInRepo = {
      findOpenOrderByTable: jest
        .fn()
        .mockResolvedValue({ id: 'o1', total: 50, branch_id: 'b1' }),
      customerBelongsToTenant: jest.fn().mockResolvedValue(customerOk),
      checkoutAtomic: jest.fn().mockResolvedValue(null),
      findOpenShiftId: jest.fn().mockResolvedValue('shift-1'),
    };
    const svc = new DineInService(
      {} as never,
      dineInRepo as never,
      {
        getInvoiceNumberFormat: jest
          .fn()
          .mockResolvedValue({ prefix: 'INV-', padding: 6 }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { svc, dineInRepo };
  };
  const dto = { payment_method: 'card', customer_id: 'c-foreign' } as never;

  it('rejects a customer that is not in the tenant before the atomic checkout', async () => {
    const { svc, dineInRepo } = mk(false);
    await expect(
      svc.checkout(tenant, 'tbl', dto, 'u', 'cashier', 'ip', 'dev'),
    ).rejects.toThrow(BadRequestException);
    expect(dineInRepo.checkoutAtomic).not.toHaveBeenCalled();
  });

  it('proceeds to the atomic checkout when the customer belongs to the tenant', async () => {
    const { svc, dineInRepo } = mk(true);
    await expect(
      svc.checkout(tenant, 'tbl', dto, 'u', 'cashier', 'ip', 'dev'),
    ).rejects.toThrow(/already checked out/);
    expect(dineInRepo.checkoutAtomic).toHaveBeenCalled();
    expect((dineInRepo.checkoutAtomic.mock.calls[0] as unknown[])[6]).toBe(
      'shift-1',
    );
  });
});
