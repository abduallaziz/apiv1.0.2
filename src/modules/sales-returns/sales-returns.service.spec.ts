import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SalesReturnsService } from './sales-returns.service';
import { TenantContext } from '../../core/tenant/tenant.context';

const TENANT = new TenantContext('tenant-1', null);
const DTO = {
  items: [{ order_item_id: 'oi-1', quantity: 1 }],
  reason: 'damaged',
};

function build() {
  const repo = {
    findOpenShiftId: jest.fn().mockResolvedValue('shift-1'),
    callCreate: jest.fn().mockResolvedValue({
      dry_run: false,
      id: 'ret-1',
      net_amount: 9,
      tax_amount: 1.35,
      refund_total: 10.35,
      refund_cash: 10.35,
      refund_noncash: 0,
      refund_method: 'cash',
      lines: [],
    }),
    getOrderReturnInfo: jest.fn(),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const cache = { delByPrefix: jest.fn().mockResolvedValue(undefined) };
  const zatca = { enabled: false, issueCreditNote: jest.fn().mockResolvedValue({ issued: false }) };
  const service = new SalesReturnsService(
    repo as never,
    audit as never,
    cache as never,
    zatca as never,
  );
  return { service, repo, audit, cache, zatca };
}

describe('SalesReturnsService', () => {
  it('passes the CURRENT open register of the actor to the database function', async () => {
    const { service, repo } = build();
    await service.create(TENANT, 'order-1', DTO, 'user-1', 'owner', 'ip', 'dev');
    expect(repo.findOpenShiftId).toHaveBeenCalledWith('tenant-1', 'user-1');
    expect(repo.callCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        shiftId: 'shift-1',
        dryRun: false,
        reason: 'damaged',
      }),
    );
  });

  it('sends a null shift when the actor has no open register (the database blocks cash refunds)', async () => {
    const { service, repo } = build();
    repo.findOpenShiftId.mockResolvedValue(null);
    await service.create(TENANT, 'order-1', DTO, 'user-1', 'owner', 'ip', 'dev');
    expect(repo.callCreate).toHaveBeenCalledWith(
      expect.objectContaining({ shiftId: null }),
    );
  });

  it('records an audit row and clears the invoice list cache after a real return', async () => {
    const { service, audit, cache } = build();
    await service.create(TENANT, 'order-1', DTO, 'user-1', 'owner', 'ip', 'dev');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'invoice.return',
        resource_id: 'order-1',
        after_data: expect.objectContaining({
          return_id: 'ret-1',
          refund_total: 10.35,
        }),
      }),
    );
    expect(cache.delByPrefix).toHaveBeenCalledWith(
      'invoices:list:tenant:tenant-1:',
    );
  });

  it('preview is a dry run: nothing audited, nothing invalidated', async () => {
    const { service, repo, audit, cache } = build();
    await service.preview(TENANT, 'order-1', DTO, 'user-1');
    expect(repo.callCreate).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
    );
    expect(audit.log).not.toHaveBeenCalled();
    expect(cache.delByPrefix).not.toHaveBeenCalled();
  });

  it('maps a database business-rule rejection (P0001) to 400 with its message', async () => {
    const { service, repo } = build();
    repo.callCreate.mockRejectedValue({
      code: 'P0001',
      message: 'Cannot return 2 of "Soap" - only 1 remaining',
    });
    await expect(
      service.create(TENANT, 'order-1', DTO, 'user-1', 'owner', 'ip', 'dev'),
    ).rejects.toThrow('Cannot return 2 of "Soap" - only 1 remaining');
    await expect(
      service.create(TENANT, 'order-1', DTO, 'user-1', 'owner', 'ip', 'dev'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not swallow unexpected errors and does not audit a failed return', async () => {
    const { service, repo, audit } = build();
    repo.callCreate.mockRejectedValue(new Error('connection lost'));
    await expect(
      service.create(TENANT, 'order-1', DTO, 'user-1', 'owner', 'ip', 'dev'),
    ).rejects.toThrow('connection lost');
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('getForOrder: 404 when the order is not in this tenant', async () => {
    const { service, repo } = build();
    repo.getOrderReturnInfo.mockResolvedValue(null);
    await expect(service.getForOrder(TENANT, 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
