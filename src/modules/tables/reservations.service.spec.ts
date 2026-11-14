import { BadRequestException, ConflictException } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { WaitlistService } from './waitlist.service';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CreateReservationDto } from './dto/create-reservation.dto';

const tenant = { tenantId: 't1' } as TenantContext;
const inHours = (h: number) =>
  new Date(Date.now() + h * 3_600_000).toISOString();

function makeReservations(
  opts: { capacity?: number; conflicts?: number } = {},
) {
  const repo = {
    findTable: jest
      .fn()
      .mockResolvedValue({ id: 'tb1', capacity: opts.capacity ?? 4 }),
    countActiveInWindow: jest.fn().mockResolvedValue(opts.conflicts ?? 0),
    create: jest.fn().mockResolvedValue({ id: 'r1' }),
    findById: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const svc = new ReservationsService(repo as never, {} as never);
  return { svc, repo };
}

const dto = (over: Partial<CreateReservationDto> = {}) =>
  ({
    table_id: 'tb1',
    customer_name: 'Ali',
    party_size: 2,
    reservation_time: inHours(5),
    ...over,
  }) as CreateReservationDto;

describe('ReservationsService.create (B-18)', () => {
  it('creates a valid future reservation', async () => {
    const { svc, repo } = makeReservations();
    await svc.create(tenant, dto());
    expect(repo.create).toHaveBeenCalled();
  });

  it('rejects a reservation in the past', async () => {
    const { svc, repo } = makeReservations();
    await expect(
      svc.create(tenant, dto({ reservation_time: inHours(-24) })),
    ).rejects.toThrow(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a party larger than the table capacity', async () => {
    const { svc } = makeReservations({ capacity: 2 });
    await expect(svc.create(tenant, dto({ party_size: 500 }))).rejects.toThrow(
      /capacity/,
    );
  });

  it('rejects a double booking of the same table', async () => {
    const { svc, repo } = makeReservations({ conflicts: 1 });
    await expect(svc.create(tenant, dto())).rejects.toThrow(ConflictException);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('WaitlistService.seat capacity (B-20)', () => {
  it('refuses to seat a party larger than the table', async () => {
    const repo = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'w1', status: 'waiting', party_size: 3 }),
    };
    const tablesRepo = {
      findById: jest.fn().mockResolvedValue({ id: 'tb1', capacity: 2 }),
    };
    const dineIn = { openTable: jest.fn() };
    const svc = new WaitlistService(
      repo as never,
      dineIn as never,
      tablesRepo as never,
    );
    await expect(svc.seat(tenant, 'w1', 'tb1', 'u1')).rejects.toThrow(
      /capacity/,
    );
    expect(dineIn.openTable).not.toHaveBeenCalled();
  });
});
