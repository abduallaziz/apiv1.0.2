import { NotFoundException } from '@nestjs/common';
import { SalesReturnsService } from './sales-returns.service';
import { TenantContext } from '../../core/tenant/tenant.context';

function build(orderInBranch: boolean) {
  const repo = {
    orderInBranch: jest.fn().mockResolvedValue(orderInBranch),
    findOpenShiftId: jest.fn().mockResolvedValue('s1'),
    callCreate: jest.fn().mockResolvedValue({ dry_run: true, lines: [] }),
    getOrderReturnInfo: jest.fn().mockResolvedValue({ order: { id: 'o1' } }),
  };
  const service = new SalesReturnsService(repo as never, {} as never, {} as never, {} as never);
  return { service, repo };
}
const DTO = { items: [{ order_item_id: 'oi', quantity: 1 }] };

describe('SalesReturnsService branch isolation', () => {
  it('does not check the branch when the tenant is not isolated', async () => {
    const { service, repo } = build(false);
    await service.getForOrder(new TenantContext('t1'), 'o1');
    expect(repo.orderInBranch).not.toHaveBeenCalled();
  });

  it('404s an order of another branch (detail and return preview)', async () => {
    const { service, repo } = build(false);
    const t = new TenantContext('t1', 'b2', true);
    await expect(service.getForOrder(t, 'o1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.preview(t, 'o1', DTO as never, 'u1')).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.callCreate).not.toHaveBeenCalled();
  });

  it('serves an order of the working branch and looks up the register in that branch', async () => {
    const { service, repo } = build(true);
    const t = new TenantContext('t1', 'b2', true);
    await service.preview(t, 'o1', DTO as never, 'u1');
    expect(repo.findOpenShiftId).toHaveBeenCalledWith('t1', 'u1', 'b2');
  });
});
