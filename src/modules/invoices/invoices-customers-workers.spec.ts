import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { PosEngine } from '../../engines/pos-engine/pos.engine';
import { DiscountEngine } from '../../engines/discount-engine/discount.engine';
import { TenantContext } from '../../core/tenant/tenant-context';

// T12 (customer capture), G4 (worker commission), G6 (invoice note),
// T11/G8 (payment methods per tenant) - InvoicesService.create/updateNote.

function build(opts: {
  enabledMethods?: string[] | null;
  resolveCapture?: jest.Mock;
  workerRates?: Map<string, number>;
  pooled?: boolean;
}) {
  const repo = {
    findBySaleAttemptId: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'order-1' }),
    insertItems: jest.fn().mockResolvedValue(['oi-1']),
    createWithItemsPooled: jest.fn().mockResolvedValue({ id: 'order-1' }),
    getInvoiceNumberFormat: jest.fn().mockResolvedValue({ prefix: 'INV-', padding: 6 }),
    getBranchDefaultWarehouse: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue({
      id: 'order-1',
      status: 'completed',
      branch_id: 'b1',
      notes: 'old',
    }),
    getWorkerRates: jest.fn().mockResolvedValue(opts.workerRates ?? new Map()),
    updateNote: jest.fn().mockResolvedValue({ id: 'order-1', notes: 'new' }),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const customers = {
    findByIdUnrestricted: jest.fn().mockResolvedValue({ id: 'c1' }),
    recordBranchActivity: jest.fn().mockResolvedValue(undefined),
    resolveCapture: opts.resolveCapture ?? jest.fn(),
  };
  const tenantsRepo = {
    getTaxConfig: jest
      .fn()
      .mockResolvedValue({ tax_rate: 0, tax_inclusive_pricing: false }),
    getEnabledPaymentMethods: jest
      .fn()
      .mockResolvedValue(opts.enabledMethods ?? null),
  };
  const config = {
    get: jest.fn((k: string) =>
      k === 'POOLED_INVOICE_WRITES_ENABLED' ? !!opts.pooled : false,
    ),
  };
  const service = new InvoicesService(
    repo as any,
    new PosEngine(new DiscountEngine()),
    { processCashPayment: jest.fn() } as any,
    audit as any,
    { recordInvoice: jest.fn() } as any,
    tenantsRepo as any,
    { getSettings: jest.fn().mockResolvedValue({ enabled: false }) } as any,
    {} as any,
    customers as any,
    { notify: jest.fn().mockResolvedValue(undefined) } as any,
    { delByPrefix: jest.fn().mockResolvedValue(undefined) } as any,
    config as any,
    { assertOpenSession: jest.fn().mockResolvedValue(undefined) } as any,
    {} as any,
    {} as any,
    {} as any,
    { findSoldByOrder: jest.fn().mockResolvedValue([]) } as any,
    {
      resolvePrice: jest
        .fn()
        .mockResolvedValue({ kind: 'no_override', officialUnitPrice: 100 }),
    } as any,
    { onOrderCompleted: jest.fn().mockResolvedValue(undefined) } as any,
    { previewSelection: jest.fn(), redeemSelected: jest.fn() } as any,
    {} as any,
    { enabled: false } as any, // zatca
  );
  return { service, repo, audit, customers, tenantsRepo };
}

const T = new TenantContext('t1', 'b1');
const dto = (extra: Record<string, unknown> = {}) =>
  ({
    branch_id: 'b1',
    sale_attempt_id: 'a1',
    items: [{ item_id: 'i1', item_name: 'Wash', quantity: 2, unit_price: 100 }],
    payment_method: 'cash',
    cash_tendered: 1000,
    ...extra,
  }) as any;
const run = (s: InvoicesService, d: any) =>
  s.create(T, d, 'u1', 'cashier', 'b1', 'shift-1', 'ip', 'dev');

describe('T11/G8 payment methods per tenant', () => {
  it('rejects a disabled method with 400 before any write', async () => {
    const { service, repo } = build({ enabledMethods: ['cash', 'card'] });
    await expect(
      run(service, dto({ payment_method: 'apple_pay' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('accepts an enabled method', async () => {
    const { service, repo } = build({ enabledMethods: ['cash', 'card'] });
    await run(service, dto({ payment_method: 'card' }));
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it('cash is never checked against the list', async () => {
    const { service, repo, tenantsRepo } = build({ enabledMethods: ['card'] });
    await run(service, dto());
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(tenantsRepo.getEnabledPaymentMethods).not.toHaveBeenCalled();
  });

  it('a null list (legacy) means every method is allowed', async () => {
    const { service, repo } = build({ enabledMethods: null });
    await run(service, dto({ payment_method: 'mada' }));
    expect(repo.create).toHaveBeenCalledTimes(1);
  });
});

describe('T12 customer_capture on the sale', () => {
  it('uses the resolved customer and stores the car on the order', async () => {
    const resolveCapture = jest.fn().mockResolvedValue({
      customer_id: 'c9',
      vehicle: { id: 'v1', plate: 'ABC 123', size: 'large' },
    });
    const { service, repo, customers } = build({ resolveCapture });
    await run(
      service,
      dto({ customer_capture: { phone: '0551234567', plate: 'ABC 123' } }),
    );
    expect(resolveCapture).toHaveBeenCalledTimes(1);
    const payload = repo.create.mock.calls[0][1];
    expect(payload.customer_id).toBe('c9');
    expect(payload.vehicle_id).toBe('v1');
    expect(payload.plate_snapshot).toBe('ABC 123');
    expect(payload.vehicle_size).toBe('large');
    expect(customers.recordBranchActivity).toHaveBeenCalledWith(T, 'c9', 'b1');
  });

  it('pooled path carries the same vehicle fields', async () => {
    const resolveCapture = jest.fn().mockResolvedValue({
      customer_id: 'c9',
      vehicle: { id: 'v1', plate: 'ABC 123', size: null },
    });
    const { service, repo } = build({ resolveCapture, pooled: true });
    await run(service, dto({ customer_capture: { plate: 'ABC 123' } }));
    const payload = repo.createWithItemsPooled.mock.calls[0][1];
    expect(payload.vehicle_id).toBe('v1');
    expect(payload.customer_id).toBe('c9');
  });

  it('a phone/plate conflict is a 409 and creates no order', async () => {
    const resolveCapture = jest
      .fn()
      .mockRejectedValue(new ConflictException('conflict'));
    const { service, repo } = build({ resolveCapture });
    await expect(
      run(service, dto({ customer_capture: { phone: '1', plate: 'X' } })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('no capture -> unchanged behaviour (null vehicle)', async () => {
    const { service, repo, customers } = build({});
    await run(service, dto());
    expect(customers.resolveCapture).not.toHaveBeenCalled();
    expect(repo.create.mock.calls[0][1].vehicle_id).toBeNull();
  });
});

describe('G4 worker per line + commission snapshot', () => {
  const lineDto = () =>
    dto({
      items: [
        {
          item_id: 'i1',
          item_name: 'Wash',
          quantity: 2,
          unit_price: 100,
          worker_id: 'w1',
        },
        { item_id: 'i2', item_name: 'Wax', quantity: 1, unit_price: 100 },
      ],
    });

  it('snapshots rate and amount from the server rate, per line', async () => {
    const { service, repo } = build({
      workerRates: new Map([['w1', 0.1]]),
    });
    await run(service, lineDto());
    const items = repo.insertItems.mock.calls[0][0];
    expect(items[0].worker_id).toBe('w1');
    expect(items[0].commission_rate).toBe(0.1);
    expect(items[0].commission_amount).toBe(20); // 2 x 100 x 10%
    expect(items[1].worker_id).toBeNull();
    expect(items[1].commission_amount).toBeNull();
  });

  it('pooled path carries the snapshot', async () => {
    const { service, repo } = build({
      workerRates: new Map([['w1', 0.05]]),
      pooled: true,
    });
    await run(service, lineDto());
    const items = repo.createWithItemsPooled.mock.calls[0][2];
    expect(items[0].commission_amount).toBe(10);
  });

  it('a worker with no rate snapshots 0', async () => {
    const { service, repo } = build({ workerRates: new Map([['w1', 0]]) });
    await run(service, lineDto());
    expect(repo.insertItems.mock.calls[0][0][0].commission_amount).toBe(0);
  });

  it('unknown / inactive worker is a 400 and nothing is written', async () => {
    const { service, repo } = build({ workerRates: new Map() });
    await expect(run(service, lineDto())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('G6 invoice note after the sale', () => {
  it('updates only the note, audits invoice.note with before/after', async () => {
    const { service, repo, audit } = build({});
    const res = await service.updateNote(
      T,
      'order-1',
      '  new  ',
      'u1',
      'cashier',
      'ip',
      'dev',
    );
    expect(repo.updateNote).toHaveBeenCalledWith(T, 'order-1', 'new');
    expect(res).toEqual({ id: 'order-1', notes: 'new' });
    const entry = audit.log.mock.calls[0][0];
    expect(entry.action).toBe('invoice.note');
    expect(entry.before_data).toEqual({ notes: 'old' });
    expect(entry.after_data).toEqual({ notes: 'new' });
  });

  it('empty text clears the note', async () => {
    const { service, repo } = build({});
    await service.updateNote(T, 'order-1', '   ', 'u1', 'c', 'ip', 'd');
    expect(repo.updateNote).toHaveBeenCalledWith(T, 'order-1', null);
  });

  it('unknown invoice -> 404', async () => {
    const { service, repo } = build({});
    repo.findById.mockResolvedValue(null);
    await expect(
      service.updateNote(T, 'x', 'n', 'u1', 'c', 'ip', 'd'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
