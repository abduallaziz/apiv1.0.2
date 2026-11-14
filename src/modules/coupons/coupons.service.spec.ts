import { BadRequestException, ConflictException } from '@nestjs/common';
import { CouponsService } from './coupons.service';

describe('CouponsService create/update rules', () => {
  const tenant = { tenantId: 't1' } as never;
  const repo = {
    findByCode: jest.fn(),
    findById: jest.fn(),
    create: jest.fn((_t, d) => Promise.resolve(d)),
    update: jest.fn((_t, _i, d) => Promise.resolve(d)),
  };
  const svc = new CouponsService(repo as never, {} as never);
  beforeEach(() => jest.clearAllMocks());

  const base = { code: 'abc', discount_type: 'percentage' as const };

  it('rejects percentage above 100', async () => {
    await expect(
      svc.create(tenant, { ...base, discount_value: 150 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows a large fixed value and uppercases the code', async () => {
    repo.findByCode.mockResolvedValue(null);
    const r = (await svc.create(tenant, {
      code: 'abc',
      discount_type: 'fixed',
      discount_value: 500,
    })) as { code: string };
    expect(r.code).toBe('ABC');
  });

  it('rejects valid_to before valid_from', async () => {
    await expect(
      svc.create(tenant, {
        ...base,
        discount_value: 10,
        valid_from: '2026-05-10',
        valid_to: '2026-05-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('duplicate code is a 409', async () => {
    repo.findByCode.mockResolvedValue({ id: 'x' });
    await expect(
      svc.create(tenant, { ...base, discount_value: 10 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('update re-checks percentage against the existing type', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      code: 'ABC',
      discount_type: 'percentage',
      discount_value: 10,
    });
    await expect(
      svc.update(tenant, 'c1', { discount_value: 200 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
