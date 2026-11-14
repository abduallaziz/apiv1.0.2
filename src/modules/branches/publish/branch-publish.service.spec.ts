import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TenantContext } from '../../../core/tenant/tenant-context';
import { BranchPublishRegistry } from './branch-publish.registry';
import { BranchPublishService } from './branch-publish.service';
import { EntityPublisher } from './branch-publish.types';
import { escapeLike } from './publishers/simple.publisher';
import { registerBuiltInPublishers } from './publishers';

const T = 't1';
const SRC = 'b-src';
const B2 = 'b-2';
const B3 = 'b-3';
const iso = new TenantContext(T, SRC, true);
const actor = { userId: 'u1', central: true };

function fakePublisher(over: Partial<EntityPublisher> = {}): EntityPublisher {
  return {
    type: 'fake',
    group: 'setup',
    labelAr: 'x',
    labelEn: 'x',
    supported: true,
    loadSources: jest.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }]),
    listSourceIds: jest.fn().mockResolvedValue(['s1', 's2']),
    findExisting: jest.fn().mockResolvedValue(null),
    exists: jest.fn().mockResolvedValue(true),
    create: jest.fn().mockResolvedValue('new-id'),
    update: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

function make(pub: EntityPublisher, provenance: Record<string, string> = {}) {
  const registry = new BranchPublishRegistry().register(pub);
  const recorded: Record<string, unknown>[] = [];
  const repo = {
    client: {},
    activeBranches: jest.fn().mockResolvedValue([
      { id: SRC, name: 'Main', is_main: true },
      { id: B2, name: 'Two', is_main: false },
      { id: B3, name: 'Three', is_main: false },
    ]),
    findTargetId: jest.fn((_t: string, _e: string, s: string, b: string) =>
      Promise.resolve(provenance[`${s}:${b}`] ?? null),
    ),
    record: jest.fn((r: Record<string, unknown>) => {
      recorded.push(r);
      return Promise.resolve();
    }),
  };
  const svc = new BranchPublishService(registry, repo as never);
  return { svc, repo, recorded };
}

const req = (over = {}) => ({
  entity_type: 'fake',
  source_ids: ['s1', 's2'],
  target_branch_ids: [B2] as string[] | 'all',
  mode: 'copy_new' as const,
  ...over,
});

describe('BranchPublishService authorization', () => {
  it('rejects branch-restricted (non central) users', async () => {
    const { svc } = make(fakePublisher());
    await expect(
      svc.publish(iso, req(), { userId: 'u', central: false }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('requires isolation to be enabled', async () => {
    const { svc } = make(fakePublisher());
    await expect(
      svc.publish(new TenantContext(T, null, false), req(), actor),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects unknown and unsupported types', async () => {
    const reg = registerBuiltInPublishers(new BranchPublishRegistry());
    const svc = new BranchPublishService(reg, {} as never);
    await expect(
      svc.publish(iso, req({ entity_type: 'nope' }), actor),
    ).rejects.toThrow(/Unknown/);
    await expect(
      svc.publish(iso, req({ entity_type: 'document_templates' }), actor),
    ).rejects.toThrow(/not supported/);
  });

  it('lists document_templates as unsupported with a reason', () => {
    const reg = registerBuiltInPublishers(new BranchPublishRegistry());
    const t = new BranchPublishService(reg, {} as never)
      .listTypes()
      .find((x) => x.type === 'document_templates');
    expect(t?.supported).toBe(false);
    expect(t?.reason).toBeTruthy();
  });
});

describe('BranchPublishService targets and sources', () => {
  it('rejects the source branch, inactive/foreign branches', async () => {
    const { svc } = make(fakePublisher());
    await expect(
      svc.publish(iso, req({ target_branch_ids: [SRC] }), actor),
    ).rejects.toThrow(/source branch/);
    await expect(
      svc.publish(iso, req({ target_branch_ids: ['other'] }), actor),
    ).rejects.toThrow(/active branch/);
  });

  it("'all' means every active branch except the source", async () => {
    const pub = fakePublisher();
    const { svc } = make(pub);
    const res = await svc.publish(
      iso,
      req({ target_branch_ids: 'all' }),
      actor,
    );
    expect(res.results.map((r) => r.branch_id)).toEqual([B2, B3]);
    expect(pub.create).toHaveBeenCalledTimes(4);
  });

  it('rejects ids that are not in the source branch', async () => {
    const pub = fakePublisher({
      loadSources: jest.fn().mockResolvedValue([{ id: 's1' }]),
    });
    const { svc } = make(pub);
    await expect(svc.publish(iso, req(), actor)).rejects.toThrow(
      /not found in the source branch/,
    );
    expect(pub.create).not.toHaveBeenCalled();
  });
});

describe('BranchPublishService idempotency and collisions', () => {
  it('creates and records provenance on first publish', async () => {
    const { svc, recorded } = make(fakePublisher());
    const res = await svc.publish(iso, req(), actor);
    expect(res.results[0]).toMatchObject({
      created: 2,
      updated: 0,
      skipped: 0,
    });
    expect(recorded).toHaveLength(2);
    expect(recorded[0]).toMatchObject({
      source_branch_id: SRC,
      target_branch_id: B2,
      target_id: 'new-id',
      created_by: 'u1',
    });
  });

  it('copy_new skips what was already published (no duplicate)', async () => {
    const pub = fakePublisher();
    const { svc } = make(pub, { [`s1:${B2}`]: 't-a', [`s2:${B2}`]: 't-b' });
    const res = await svc.publish(iso, req(), actor);
    expect(res.results[0]).toMatchObject({
      created: 0,
      updated: 0,
      skipped: 2,
    });
    expect(pub.create).not.toHaveBeenCalled();
    expect(pub.update).not.toHaveBeenCalled();
  });

  it('update_existing updates published rows and creates missing ones', async () => {
    const pub = fakePublisher();
    const { svc } = make(pub, { [`s1:${B2}`]: 't-a' });
    const res = await svc.publish(iso, req({ mode: 'update_existing' }), actor);
    expect(res.results[0]).toMatchObject({
      created: 1,
      updated: 1,
      skipped: 0,
    });
    expect(pub.update).toHaveBeenCalledWith(
      expect.anything(),
      { id: 's1' },
      't-a',
      B2,
    );
  });

  it('a natural-key collision links the existing row instead of failing', async () => {
    const pub = fakePublisher({
      findExisting: jest.fn().mockResolvedValue('existing'),
    });
    const { svc, recorded } = make(pub);
    const res = await svc.publish(iso, req(), actor);
    expect(res.results[0]).toMatchObject({ created: 0, skipped: 2, failed: 0 });
    expect(recorded[0]).toMatchObject({ target_id: 'existing' });
  });

  it('a provenance row whose target was deleted is re-created/matched', async () => {
    const pub = fakePublisher({ exists: jest.fn().mockResolvedValue(false) });
    const { svc } = make(pub, { [`s1:${B2}`]: 'gone' });
    const res = await svc.publish(iso, req(), actor);
    expect(res.results[0].created).toBe(2);
  });

  it('one failing record is reported without stopping the others', async () => {
    const create = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue('ok');
    const { svc } = make(fakePublisher({ create }));
    const res = await svc.publish(iso, req(), actor);
    expect(res.results[0]).toMatchObject({ created: 1, failed: 1 });
    expect(res.results[0].errors[0]).toEqual({
      source_id: 's1',
      message: 'boom',
    });
  });
});

describe('copySetupFromMain', () => {
  it('copies only setup-group types with copy_new and never throws', async () => {
    const setup = fakePublisher({ type: 'a', group: 'setup' });
    const promo = fakePublisher({ type: 'b', group: 'promotions' });
    const broken = fakePublisher({
      type: 'c',
      group: 'setup',
      listSourceIds: jest.fn().mockRejectedValue(new Error('x')),
    });
    const registry = new BranchPublishRegistry()
      .register(setup)
      .register(promo)
      .register(broken);
    const repo = {
      client: {},
      activeBranches: jest.fn().mockResolvedValue([
        { id: SRC, name: 'Main', is_main: true },
        { id: B2, name: 'Two', is_main: false },
      ]),
      findTargetId: jest.fn().mockResolvedValue(null),
      record: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new BranchPublishService(registry, repo as never);
    const out = await svc.copySetupFromMain(T, SRC, B2, 'u1');
    expect(out.map((o) => o.entity_type)).toEqual(['a']);
    expect(promo.create).not.toHaveBeenCalled();
  });
});

describe('registry and helpers', () => {
  it('refuses duplicate registration', () => {
    const r = new BranchPublishRegistry().register(fakePublisher());
    expect(() => r.register(fakePublisher())).toThrow(/already registered/);
  });

  it('built-ins cover the required types', () => {
    const types = registerBuiltInPublishers(new BranchPublishRegistry())
      .list()
      .map((p) => p.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'items',
        'categories',
        'brands',
        'units',
        'shift_patterns',
        'coupons',
        'reward_definitions',
        'loyalty_tiers',
        'note_presets',
        'customer_field_definitions',
        'expense_categories_v2',
        'expense_departments',
        'document_templates',
      ]),
    );
  });

  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});
