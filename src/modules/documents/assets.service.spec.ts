import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { TenantContext } from '../../core/tenant/tenant-context';

type Row = Record<string, unknown>;

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(8),
  Buffer.from([0, 0, 0, 40, 0, 0, 0, 30]),
]);

function setup(answers: Array<[string, Row[]]> = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: jest.fn((sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const hit = answers.find(([f]) => sql.includes(f));
      return Promise.resolve({
        rows: hit ? hit[1] : [],
        rowCount: hit ? 1 : 0,
      });
    }),
  };
  const session = {
    runInTenantContext: (_t: TenantContext, fn: (c: unknown) => unknown) =>
      fn(client),
  };
  const storage = {
    upload: jest
      .fn<
        Promise<{ storagePath: string; fileUrl: string }>,
        [{ tenantId: string }]
      >()
      .mockResolvedValue({ storagePath: 'p/1.png', fileUrl: 'x' }),
    getSignedUrl: jest.fn().mockResolvedValue('https://signed'),
  };
  const audit = {
    log: jest
      .fn<Promise<void>, [{ action: string }]>()
      .mockResolvedValue(undefined),
  };
  const svc = new AssetsService(
    session as never,
    storage as never,
    audit as never,
  );
  return { svc, calls, storage, audit };
}

const tenant = new TenantContext('tenant-1');
const file = (buffer: Buffer): Express.Multer.File =>
  ({
    buffer,
    size: buffer.length,
    originalname: 'stamp.png',
  }) as Express.Multer.File;
const dto = { name: 'Stamp', category: 'company_stamp' as const };

describe('AssetsService', () => {
  it('rejects a missing file', async () => {
    const { svc } = setup();
    await expect(
      svc.create(tenant, 'u', dto, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-image disguised with an image mime (magic bytes checked)', async () => {
    const { svc, storage } = setup();
    await expect(
      svc.create(tenant, 'u', dto, file(Buffer.from('<svg onload=alert(1)>'))),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('uploads a PNG privately, records size + version 1, never returns storage_path', async () => {
    const { svc, calls, storage, audit } = setup([
      [
        'INSERT INTO document_assets',
        [{ id: 'a1', category: 'company_stamp' }],
      ],
    ]);
    const r = await svc.create(tenant, 'u', dto, file(PNG));
    expect(r.id).toBe('a1');
    expect(storage.upload.mock.calls[0][0].tenantId).toBe('tenant-1');
    const ins = calls.find((c) =>
      c.sql.includes('INSERT INTO document_assets'),
    );
    expect(ins?.params).toContain(40); // width read from PNG header
    expect(ins?.params).toContain(30);
    expect(ins?.sql).not.toMatch(/RETURNING[^;]*storage_path/);
    expect(
      calls.some((c) => c.sql.includes('INSERT INTO document_asset_versions')),
    ).toBe(true);
    expect(audit.log).toHaveBeenCalled();
  });

  it('rejects a branch of another tenant', async () => {
    const { svc } = setup([['FROM branches', []]]);
    await expect(
      svc.create(tenant, 'u', { ...dto, branch_id: 'foreign' }, file(PNG)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s on an asset outside the tenant', async () => {
    const { svc } = setup([['FOR UPDATE', []]]);
    await expect(svc.signedUrl(tenant, 'u', 'a1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('signed URL for a stamp is short-lived and audited without the URL', async () => {
    const { svc, storage, audit } = setup([
      [
        'FOR UPDATE',
        [
          {
            id: 'a1',
            category: 'signature',
            status: 'active',
            storage_path: 'p/1.png',
          },
        ],
      ],
    ]);
    const r = await svc.signedUrl(tenant, 'u', 'a1');
    expect(r.expires_in).toBe(300);
    expect(storage.getSignedUrl).toHaveBeenCalledWith('p/1.png', 300);
    const entry = audit.log.mock.calls[0][0];
    expect(entry.action).toBe('document_asset.signed_url');
    expect(JSON.stringify(entry)).not.toContain('https://signed');
  });

  it('archived assets cannot be fetched', async () => {
    const { svc } = setup([
      [
        'FOR UPDATE',
        [{ id: 'a1', category: 'logo', status: 'archived', storage_path: 'p' }],
      ],
    ]);
    await expect(svc.signedUrl(tenant, 'u', 'a1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a role owned by another tenant', async () => {
    const { svc } = setup([
      ['FOR UPDATE', [{ id: 'a1', category: 'logo', status: 'active' }]],
      ['FROM roles', [{ tenant_id: 'other-tenant' }]],
    ]);
    await expect(
      svc.addPermission(tenant, 'a1', { role_id: 'r1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
