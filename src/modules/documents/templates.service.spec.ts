import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { TenantContext } from '../../core/tenant/tenant-context';

type Row = Record<string, unknown>;

// Scripted pg client: each query is matched by a SQL fragment and answered from `answers`.
function makeService(answers: Array<[string, Row[]]>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: jest.fn((sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const hit = answers.find(([frag]) => sql.includes(frag));
      return Promise.resolve({ rows: hit ? hit[1] : [] });
    }),
  };
  const session = {
    runInTenantContext: (_t: TenantContext, fn: (c: unknown) => unknown) =>
      fn(client),
  };
  const svc = new TemplatesService(session as never);
  return { svc, calls };
}

const tenant = new TenantContext('tenant-1');
const tpl = (over: Row = {}) => ({
  id: 't1',
  tenant_id: 'tenant-1',
  doc_type: 'quotation',
  name: 'Q',
  status: 'draft',
  is_default: false,
  paper: 'A4',
  orientation: 'portrait',
  current_version_id: null,
  ...over,
});

describe('TemplatesService', () => {
  it('404s when the template is not in this tenant', async () => {
    const { svc } = makeService([['FOR UPDATE', []]]);
    await expect(svc.publish(tenant, 't1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('always scopes the lock query by tenant_id', async () => {
    const { svc, calls } = makeService([['FOR UPDATE', []]]);
    await svc.archive(tenant, 't1').catch(() => undefined);
    expect(calls[0].sql).toContain('tenant_id = $2');
    expect(calls[0].params).toEqual(['t1', 'tenant-1']);
  });

  it('only a published template can be default', async () => {
    const { svc } = makeService([['FOR UPDATE', [tpl({ status: 'draft' })]]]);
    await expect(svc.setDefault(tenant, 't1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('only a published template can be assigned', async () => {
    const { svc } = makeService([['FOR UPDATE', [tpl({ status: 'draft' })]]]);
    await expect(
      svc.assign(tenant, 't1', { scope: 'tenant' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('branch scope requires branch_id, tenant scope forbids it', async () => {
    const { svc } = makeService([]);
    await expect(
      svc.assign(tenant, 't1', { scope: 'branch' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.assign(tenant, 't1', { scope: 'tenant', branch_id: 'b1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a branch that belongs to another tenant', async () => {
    const { svc } = makeService([
      ['FOR UPDATE', [tpl({ status: 'published' })]],
      ['FROM branches', []],
    ]);
    await expect(
      svc.assign(tenant, 't1', { scope: 'branch', branch_id: 'foreign' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('editing the published version creates a NEW version', async () => {
    const { svc, calls } = makeService([
      ['FOR UPDATE', [tpl({ status: 'published', current_version_id: 'v1' })]],
      ['ORDER BY version DESC', [{ id: 'v1', version: 1, body: {} }]],
      ['INSERT INTO document_template_versions', [{ id: 'v2', version: 2 }]],
    ]);
    const r = await svc.update(tenant, 'u1', 't1', { body: { elements: [] } });
    expect(r.draft_version).toBe(2);
    expect(
      calls.some((c) =>
        c.sql.includes('INSERT INTO document_template_versions'),
      ),
    ).toBe(true);
  });

  it('editing an unpublished draft updates it in place', async () => {
    const { svc, calls } = makeService([
      ['FOR UPDATE', [tpl({ current_version_id: null })]],
      ['ORDER BY version DESC', [{ id: 'v1', version: 1, body: {} }]],
    ]);
    const r = await svc.update(tenant, 'u1', 't1', { body: { elements: [] } });
    expect(r.draft_version).toBe(1);
    expect(
      calls.some((c) =>
        c.sql.includes('INSERT INTO document_template_versions'),
      ),
    ).toBe(false);
  });

  it('archived templates cannot be edited, published or restored', async () => {
    const { svc } = makeService([
      ['FOR UPDATE', [tpl({ status: 'archived' })]],
    ]);
    await expect(svc.update(tenant, 'u', 't1', {})).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(svc.publish(tenant, 't1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      svc.restoreVersion(tenant, 'u', 't1', 1),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('restore copies the old body into a new version', async () => {
    const { svc } = makeService([
      ['FOR UPDATE', [tpl()]],
      ['SELECT body FROM document_template_versions', [{ body: { a: 1 } }]],
      ['INSERT INTO document_template_versions', [{ id: 'v3', version: 3 }]],
    ]);
    const r = await svc.restoreVersion(tenant, 'u', 't1', 1);
    expect(r.draft_version).toBe(3);
  });
});

describe('TemplatesService body validation', () => {
  it('rejects an asset that is not in this tenant', async () => {
    const { svc } = makeService([
      ['FOR UPDATE', [tpl()]],
      ['FROM document_assets', []], // none found for this tenant
    ]);
    const body = {
      elements: [
        {
          id: 'e1',
          type: 'stamp',
          assetId: '11111111-1111-4111-8111-111111111111',
        },
      ],
    };
    await expect(
      svc.update(tenant, 'u', 't1', { body }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects malformed bodies before touching the database', async () => {
    const { svc, calls } = makeService([]);
    await expect(
      svc.create(tenant, 'u', {
        doc_type: 'quotation',
        name: 'Q',
        body: { elements: [{ id: 'x', type: 'script' }] },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toHaveLength(0);
  });
});
