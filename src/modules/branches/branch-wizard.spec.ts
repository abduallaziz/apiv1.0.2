import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { BranchesService } from './branches.service';
import { BranchPublishRegistry } from './publish/branch-publish.registry';
import { BranchPublishService } from './publish/branch-publish.service';
import { EntityPublisher } from './publish/branch-publish.types';
import { BranchProfileDto, checkWorkingHours } from './dto/branch-profile.dto';
import { CreateBranchDto } from './dto/create-branch.dto';

const errs = (o: object, cls: new () => object = BranchProfileDto) =>
  validateSync(plainToInstance(cls, o)).map((e) => e.property);

describe('branch profile DTO', () => {
  it('accepts a valid profile and normalises digits/case', () => {
    const dto = plainToInstance(BranchProfileDto, {
      short_code: ' ab1 ',
      tax_number: '٣١' + '0'.repeat(12) + '٣',
      phone: '0551234567',
    });
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.short_code).toBe('AB1');
    expect(dto.tax_number).toBe('31' + '0'.repeat(12) + '3');
  });
  it('rejects bad short code, vat, email, printer, footer', () => {
    expect(errs({ short_code: 'A' })).toContain('short_code');
    expect(errs({ short_code: 'ABCDEFG' })).toContain('short_code');
    expect(errs({ short_code: 'A-B' })).toContain('short_code');
    expect(errs({ tax_number: '123' })).toContain('tax_number');
    expect(errs({ email: 'nope' })).toContain('email');
    expect(errs({ printer_size: '70mm' })).toContain('printer_size');
    expect(errs({ invoice_footer: 'x'.repeat(501) })).toContain(
      'invoice_footer',
    );
  });
  it('treats empty strings as cleared (null)', () => {
    const dto = plainToInstance(BranchProfileDto, {
      short_code: '',
      city: ' ',
    });
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.short_code).toBeNull();
    expect(dto.city).toBeNull();
  });
  it('validates the working_hours JSON shape', () => {
    const ok = { mon: { open: '09:00', close: '22:00', closed: false } };
    expect(checkWorkingHours(ok)).toBeNull();
    expect(checkWorkingHours({ fri: { closed: true } })).toBeNull();
    expect(checkWorkingHours({ xyz: { closed: true } })).not.toBeNull();
    expect(
      checkWorkingHours({
        mon: { open: '9:00', close: '22:00', closed: false },
      }),
    ).not.toBeNull();
    expect(checkWorkingHours([])).not.toBeNull();
    expect(errs({ working_hours: { mon: { closed: 'no' } } })).toContain(
      'working_hours',
    );
  });
  it('create DTO validates wizard_copy', () => {
    const bad = errs(
      {
        name: 'x',
        wizard_copy: { source_branch_id: 'nope', entity_types: ['x'] },
      },
      CreateBranchDto,
    );
    expect(bad).toContain('wizard_copy');
    expect(errs({ name: 'x' }, CreateBranchDto)).toHaveLength(0);
  });
});

describe('BranchesService wizard paths', () => {
  const tenant = new TenantContext('t1', 'main', true);
  function make(over: Record<string, unknown> = {}, publisher?: unknown) {
    const repo = {
      nameExists: jest.fn().mockResolvedValue(false),
      shortCodeExists: jest.fn().mockResolvedValue(false),
      create: jest.fn().mockImplementation((_t, d) => ({ id: 'nb', ...d })),
      ensureAccountingOwner: jest.fn().mockResolvedValue(true),
      findById: jest.fn().mockResolvedValue({ id: 'b1', name: 'Old' }),
      update: jest.fn().mockResolvedValue({ id: 'b1' }),
      renameAutoWarehouse: jest.fn(),
      ...over,
    };
    const billing = { checkBranchLimit: jest.fn() };
    const svc = new BranchesService(
      repo as never,
      billing as never,
      { invalidate: jest.fn() } as never,
      publisher as never,
    );
    return { svc, repo: repo as Record<string, jest.Mock>, billing };
  }

  it('409 on a taken short code (create and update)', async () => {
    const { svc } = make({
      shortCodeExists: jest.fn().mockResolvedValue(true),
    });
    await expect(
      svc.create({ name: 'N', short_code: 'AB' }, tenant),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      svc.update('b1', { short_code: 'AB' }, tenant),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('maps a unique-index race to 409', async () => {
    const { svc } = make({
      create: jest.fn().mockRejectedValue({
        code: '23505',
        message: 'duplicate key uq_branches_tenant_short_code (short_code)',
      }),
    });
    await expect(
      svc.create({ name: 'N', short_code: 'AB' }, tenant),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('rejects a bad phone and normalises Arabic digits', async () => {
    const { svc, repo } = make();
    await expect(
      svc.create({ name: 'N', phone: 'abc' }, tenant),
    ).rejects.toBeInstanceOf(BadRequestException);
    await svc.create({ name: 'N', phone: '٠٥٥١٢٣٤٥٦٧' }, tenant);
    expect(repo.create.mock.calls[0][1].phone).toBe('0551234567');
  });
  it('passes warehouse_name through; plain {name} still works', async () => {
    const { svc, repo } = make();
    await svc.create({ name: 'N', warehouse_name: 'My WH' }, tenant);
    expect(repo.create.mock.calls[0][2]).toBe('My WH');
    await svc.create({ name: 'M' }, tenant);
    expect(repo.create.mock.calls[1][2]).toBeUndefined();
  });
  it('validates the wizard copy before creating the branch', async () => {
    const publisher = {
      assertCanCopyFromBranch: jest
        .fn()
        .mockRejectedValue(new ForbiddenException('no')),
      copyFromBranch: jest.fn(),
    };
    const { svc, repo, billing } = make({}, publisher);
    await expect(
      svc.create(
        {
          name: 'N',
          wizard_copy: { source_branch_id: 'main', entity_types: ['items'] },
        },
        tenant,
        'u1',
        false,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.create).not.toHaveBeenCalled();
    expect(billing.checkBranchLimit).not.toHaveBeenCalled();
  });
  it('returns the per-type summary after creation', async () => {
    const summary = [{ entity_type: 'items', ok: true, created: 2 }];
    const publisher = {
      assertCanCopyFromBranch: jest.fn().mockResolvedValue(undefined),
      copyFromBranch: jest.fn().mockResolvedValue(summary),
    };
    const { svc } = make({}, publisher);
    const res = await svc.create(
      {
        name: 'N',
        wizard_copy: { source_branch_id: 'main', entity_types: ['items'] },
      },
      tenant,
      'u1',
      true,
    );
    expect((res as unknown as { wizard_copy: unknown }).wizard_copy).toBe(
      summary,
    );
  });
});

describe('BranchPublishService.copyFromBranch', () => {
  const SRC = 'src';
  const NEW = 'new';
  const iso = new TenantContext('t1', SRC, true);
  const central = { userId: 'u', central: true };
  const pub = (type: string, over: Partial<EntityPublisher> = {}) =>
    ({
      type,
      group: 'setup',
      labelAr: 'x',
      labelEn: 'x',
      supported: true,
      loadSources: jest.fn().mockResolvedValue([{ id: 's1' }]),
      listSourceIds: jest.fn().mockResolvedValue(['s1']),
      findExisting: jest.fn().mockResolvedValue(null),
      exists: jest.fn().mockResolvedValue(true),
      create: jest.fn().mockResolvedValue('n1'),
      update: jest.fn(),
      ...over,
    }) as EntityPublisher;
  function make(...pubs: EntityPublisher[]) {
    const registry = new BranchPublishRegistry();
    pubs.forEach((p) => registry.register(p));
    const repo = {
      client: {},
      activeBranches: jest.fn().mockResolvedValue([
        { id: SRC, name: 'Main', is_main: true },
        { id: NEW, name: 'New', is_main: false },
      ]),
      findTargetId: jest.fn().mockResolvedValue(null),
      record: jest.fn().mockResolvedValue(undefined),
    };
    return new BranchPublishService(registry, repo as never);
  }
  const req = (types: string[]) => ({
    source_branch_id: SRC,
    entity_types: types,
  });

  it('is central-only', async () => {
    const svc = make(pub('a'));
    await expect(
      svc.copyFromBranch(iso, req(['a']), NEW, {
        userId: 'u',
        central: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('needs isolation on', async () => {
    const svc = make(pub('a'));
    await expect(
      svc.copyFromBranch(
        new TenantContext('t1', null, false),
        req(['a']),
        NEW,
        central,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('refuses source == new branch and unknown types', async () => {
    const svc = make(pub('a'));
    await expect(
      svc.copyFromBranch(
        iso,
        { ...req(['a']), source_branch_id: NEW },
        NEW,
        central,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.copyFromBranch(iso, req(['zzz']), NEW, central),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('isolates a failing type from the others', async () => {
    const bad = pub('bad', {
      listSourceIds: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const good = pub('good');
    const svc = make(bad, good);
    const res = await svc.copyFromBranch(
      iso,
      req(['bad', 'good']),
      NEW,
      central,
    );
    const by = Object.fromEntries(res.map((r) => [r.entity_type, r]));
    expect(by.bad.ok).toBe(false);
    expect(by.bad.error).toBe('boom');
    expect(by.good).toMatchObject({ ok: true, created: 1 });
    expect(good.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      NEW,
    );
  });
});
