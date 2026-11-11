import { ConflictException, BadRequestException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { normalizePhone, normalizePlate } from './customer-normalize';
import { TenantContext } from '../../core/tenant/tenant-context';

describe('T12 normalisation', () => {
  it('phone: digits only, last 9, Arabic-Indic handled', () => {
    expect(normalizePhone('0551234567')).toBe('551234567');
    expect(normalizePhone('+966 55 123 4567')).toBe('551234567');
    expect(normalizePhone('00966551234567')).toBe('551234567');
    expect(normalizePhone('٠٥٥١٢٣٤٥٦٧')).toBe('551234567');
    expect(normalizePhone('۰۵۵۱۲۳۴۵۶۷')).toBe('551234567');
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
  it('plate: no spaces/dashes, upper-case, English digits', () => {
    expect(normalizePlate('abc - 1234')).toBe('ABC1234');
    expect(normalizePlate('أ ب ج ١٢٣')).toBe('أبج123');
    expect(normalizePlate('  ')).toBeNull();
  });
});

const T = new TenantContext('t1', 'b1');
const USER = { sub: 'u1', role: 'cashier', branch_id: 'b1' } as any;

function build() {
  const repo = {
    findByPhoneNormalized: jest.fn().mockResolvedValue(null),
    findVehicleByPlate: jest.fn().mockResolvedValue(null),
    findById: jest.fn(),
    listVehicles: jest.fn().mockResolvedValue([]),
    getStats: jest.fn().mockResolvedValue({
      orders_count: 3,
      total_spent: 300,
      last_order_at: '2026-11-01',
      avg_order: 100,
    }),
    createVehicle: jest.fn().mockImplementation(async (_t, p) => ({
      id: 'v-new',
      size: null,
      ...p,
    })),
    updateVehicleSize: jest.fn().mockResolvedValue(undefined),
    findByPhone: jest.fn().mockResolvedValue(null),
    countAll: jest.fn().mockResolvedValue(0),
    create: jest
      .fn()
      .mockImplementation(async (_t, p) => ({ id: 'c-new', ...p })),
    upsertRelationship: jest.fn().mockResolvedValue(undefined),
  };
  const fieldDefs = { findAll: jest.fn().mockResolvedValue([]) };
  const tenants = {
    getPosConfig: jest.fn().mockResolvedValue({ name_field_enabled: false }),
  };
  const service = new CustomersService(
    repo as any,
    fieldDefs as any,
    tenants as any,
  );
  return { service, repo, fieldDefs };
}

describe('CustomersService.lookup', () => {
  it('needs a plate or a phone', async () => {
    const { service } = build();
    await expect(service.lookup(T, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('not found -> found:false', async () => {
    const { service } = build();
    const r = await service.lookup(T, { plate: 'abc 1' });
    expect(r.found).toBe(false);
  });

  it('plate match returns customer, cars, stats and that car', async () => {
    const { service, repo } = build();
    repo.findVehicleByPlate.mockResolvedValue({
      id: 'v1',
      customer_id: 'c1',
      plate: 'ABC 1',
    });
    repo.findById.mockResolvedValue({ id: 'c1' });
    repo.listVehicles.mockResolvedValue([
      { id: 'v1', customer_id: 'c1' },
      { id: 'v2', customer_id: 'c1' },
    ]);
    const r = await service.lookup(T, { plate: 'abc-1' });
    expect(repo.findVehicleByPlate).toHaveBeenCalledWith(T, 'ABC1');
    expect(r.matched_by).toBe('plate');
    expect(r.vehicle?.id).toBe('v1');
    expect(r.vehicles).toHaveLength(2);
    expect(r.stats).toEqual({
      visit_count: 3,
      last_visit_at: '2026-11-01',
      total_spent: 300,
    });
  });

  it('phone match with several cars -> list, no automatic car', async () => {
    const { service, repo } = build();
    repo.findByPhoneNormalized.mockResolvedValue({ id: 'c1' });
    repo.listVehicles.mockResolvedValue([{ id: 'v1' }, { id: 'v2' }]);
    const r = await service.lookup(T, { phone: '0551234567' });
    expect(repo.findByPhoneNormalized).toHaveBeenCalledWith(T, '551234567');
    expect(r.vehicle).toBeNull();
    expect(r.vehicles).toHaveLength(2);
  });

  it('phone match with exactly one car selects it', async () => {
    const { service, repo } = build();
    repo.findByPhoneNormalized.mockResolvedValue({ id: 'c1' });
    repo.listVehicles.mockResolvedValue([{ id: 'v1' }]);
    const r = await service.lookup(T, { phone: '0551234567' });
    expect(r.vehicle).toEqual({ id: 'v1' });
  });

  it('phone of A + plate of B -> 409, no merge', async () => {
    const { service, repo } = build();
    repo.findByPhoneNormalized.mockResolvedValue({ id: 'A' });
    repo.findVehicleByPlate.mockResolvedValue({ id: 'v', customer_id: 'B' });
    await expect(
      service.lookup(T, { phone: '0551234567', plate: 'X1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('CustomersService.resolveCapture', () => {
  const cap = { phone: '0551234567', plate: 'abc 123', size: 'large' };

  it('new phone + new plate -> creates ONE customer and ONE car', async () => {
    const { service, repo } = build();
    const r = await service.resolveCapture(T, USER, cap);
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(repo.createVehicle).toHaveBeenCalledTimes(1);
    expect(repo.createVehicle.mock.calls[0][1]).toMatchObject({
      customer_id: 'c-new',
      plate: 'abc 123',
      size: 'large',
    });
    expect(r?.customer_id).toBe('c-new');
    expect(r?.vehicle?.id).toBe('v-new');
  });

  it('idempotent: same phone+plate again resolves to the existing rows', async () => {
    const { service, repo } = build();
    repo.findByPhoneNormalized.mockResolvedValue({ id: 'c1' });
    repo.findVehicleByPlate.mockResolvedValue({
      id: 'v1',
      customer_id: 'c1',
      plate: 'abc 123',
      size: 'large',
    });
    const r = await service.resolveCapture(T, USER, cap);
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.createVehicle).not.toHaveBeenCalled();
    expect(r).toEqual({
      customer_id: 'c1',
      vehicle: { id: 'v1', plate: 'abc 123', size: 'large' },
    });
  });

  it('known phone, new plate -> new car on the SAME customer', async () => {
    const { service, repo } = build();
    repo.findByPhoneNormalized.mockResolvedValue({ id: 'c1' });
    const r = await service.resolveCapture(T, USER, cap);
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.createVehicle.mock.calls[0][1].customer_id).toBe('c1');
    expect(r?.customer_id).toBe('c1');
  });

  it('known plate only -> that customer', async () => {
    const { service, repo } = build();
    repo.findVehicleByPlate.mockResolvedValue({
      id: 'v1',
      customer_id: 'c7',
      plate: 'abc 123',
      size: 'large',
    });
    const r = await service.resolveCapture(T, USER, { plate: 'ABC-123' });
    expect(r?.customer_id).toBe('c7');
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('phone of A + plate of B -> 409 and nothing is written', async () => {
    const { service, repo } = build();
    repo.findByPhoneNormalized.mockResolvedValue({ id: 'A' });
    repo.findVehicleByPlate.mockResolvedValue({ id: 'v', customer_id: 'B' });
    await expect(service.resolveCapture(T, USER, cap)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.createVehicle).not.toHaveBeenCalled();
  });

  it('explicit customer_id that differs from the plate owner -> 409', async () => {
    const { service, repo } = build();
    repo.findVehicleByPlate.mockResolvedValue({ id: 'v', customer_id: 'B' });
    await expect(
      service.resolveCapture(T, USER, { plate: 'X1' }, 'A'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('explicit customer_id + unknown plate -> car attached to that customer', async () => {
    const { service, repo } = build();
    const r = await service.resolveCapture(T, USER, { plate: 'X1' }, 'A');
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.createVehicle.mock.calls[0][1].customer_id).toBe('A');
    expect(r?.customer_id).toBe('A');
  });

  it('size change on an existing car is saved', async () => {
    const { service, repo } = build();
    repo.findVehicleByPlate.mockResolvedValue({
      id: 'v1',
      customer_id: 'c1',
      plate: 'X1',
      size: 'small',
    });
    const r = await service.resolveCapture(T, USER, {
      plate: 'X1',
      size: 'large',
    });
    expect(repo.updateVehicleSize).toHaveBeenCalledWith(T, 'v1', 'large');
    expect(r?.vehicle?.size).toBe('large');
  });

  it('a unique violation on the plate insert (race) becomes a 409', async () => {
    const { service, repo } = build();
    repo.createVehicle.mockRejectedValue({ code: '23505', message: 'dup' });
    await expect(
      service.resolveCapture(T, USER, { plate: 'X1' }, 'A'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('empty capture without customer_id -> null', async () => {
    const { service } = build();
    expect(await service.resolveCapture(T, USER, {})).toBeNull();
  });

  it('a value in a custom field only (no phone/plate) -> creates a customer', async () => {
    const { service, repo, fieldDefs } = build();
    fieldDefs.findAll.mockResolvedValue([
      {
        field_key: 'qa_note',
        field_type: 'text',
        required: false,
        is_active: true,
        contact_role: null,
      },
    ]);
    const r = await service.resolveCapture(T, USER, {
      custom_fields: { qa_note: 'VIP' },
    });
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(repo.createVehicle).not.toHaveBeenCalled();
    expect(r?.customer_id).toBe('c-new');
    expect(r?.vehicle).toBeNull();
  });

  it('a name only (no phone/plate) -> creates a customer', async () => {
    const { service, repo } = build();
    const r = await service.resolveCapture(T, USER, { name: 'Ali' });
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(r?.customer_id).toBe('c-new');
  });

  it('blank custom values / blank name do not create a customer', async () => {
    const { service, repo } = build();
    const r = await service.resolveCapture(T, USER, {
      name: '  ',
      custom_fields: { qa_note: '', other: null },
    });
    expect(r).toBeNull();
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('CustomersService.addVehicle', () => {
  it('plate owned by another customer -> 409', async () => {
    const { service, repo } = build();
    repo.findById.mockResolvedValue({ id: 'A' });
    repo.findVehicleByPlate.mockResolvedValue({ id: 'v', customer_id: 'B' });
    (service as any).resolveVisibilityBranchId = jest
      .fn()
      .mockResolvedValue(null);
    await expect(
      service.addVehicle(T, USER, 'A', { plate: 'x 1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('CustomersService.getStats range', () => {
  it('passes a range to the repository only when both ends are given', async () => {
    const { service, repo } = build();
    const getGlobalStats = jest.fn().mockResolvedValue({ total: 0 });
    (repo as any).getGlobalStats = getGlobalStats;

    await service.getStats(T, '2026-11-01', '2026-11-10');
    expect(getGlobalStats).toHaveBeenLastCalledWith(T, {
      from: '2026-11-01',
      to: '2026-11-10',
    });

    await service.getStats(T, '2026-11-01');
    expect(getGlobalStats).toHaveBeenLastCalledWith(T, undefined);

    await service.getStats(T);
    expect(getGlobalStats).toHaveBeenLastCalledWith(T, undefined);
  });
});
