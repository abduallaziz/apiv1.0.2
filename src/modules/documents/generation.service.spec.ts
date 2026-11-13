import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { GenerationService, type Actor } from './generation.service';
import { TemplateRenderService } from './template-render.service';
import { computeManualTotals } from './document-sources';
import { TenantContext } from '../../core/tenant/tenant-context';

type Row = Record<string, unknown>;
type Answer = Row[] | ((params: unknown[]) => Row[]);

const ASSET = '11111111-1111-4111-8111-111111111111';
const TEMPLATE = '22222222-2222-4222-8222-222222222222';
const VERSION = '33333333-3333-4333-8333-333333333333';
const ROLE = '44444444-4444-4444-8444-444444444444';
const OLD = new Date('2026-01-01T00:00:00Z');
const NEW = new Date('2026-02-01T00:00:00Z');

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
]);

const body = (extra: Row[] = []) => ({
  pages: [{}],
  elements: [
    { id: 'h', type: 'heading', config: { text: '{{document.number}}' } },
    { id: 'tot', type: 'totals' },
    {
      id: 's',
      type: 'stamp',
      assetId: ASSET,
      position: { x: 10, y: 10 },
      size: { width: 30, height: 30 },
    },
    {
      id: 'q',
      type: 'qr',
      config: { kind: 'verification' },
      position: { x: 50, y: 10 },
      size: { width: 30, height: 30 },
    },
    ...extra,
  ],
});

const templateRow = (over: Row = {}) => ({
  id: TEMPLATE,
  doc_type: 'quotation',
  paper: 'A4',
  orientation: 'portrait',
  vid: VERSION,
  vcreated: OLD,
  body: body(),
  ...over,
});

const assetRow = (over: Row = {}) => ({
  id: ASSET,
  category: 'company_stamp',
  storage_path: 'p/stamp.png',
  mime: 'image/png',
  checksum: 'abc',
  status: 'active',
  ...over,
});

interface Setup {
  answers?: Array<[string, Answer]>;
}

function setup({ answers = [] }: Setup = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const defaults: Array<[string, Answer]> = [
    ['FROM document_templates t', [templateRow()]],
    ['FROM document_assets', [assetRow()]],
    ['FROM document_approvals', [{ decision: 'approved', approved_at: NEW }]],
    [
      'FROM tenants',
      [
        {
          name: 'Acme',
          tax_number: '300000000000003',
          phone: null,
          email: null,
          address: null,
          tax_rate: '0.15',
          tax_inclusive_pricing: false,
        },
      ],
    ],
    ['FROM roles', [{ id: ROLE }]],
    ['FROM document_asset_permissions', []],
  ];
  const all = [...answers, ...defaults];
  const client = {
    query: jest.fn((sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const hit = all.find(([frag]) => sql.includes(frag));
      const rows = hit
        ? typeof hit[1] === 'function'
          ? hit[1](params)
          : hit[1]
        : [];
      return Promise.resolve({ rows, rowCount: rows.length });
    }),
  };
  const session = {
    runInTenantContext: (_t: TenantContext, fn: (c: unknown) => unknown) =>
      fn(client),
  };
  const storage = {
    getSignedUrl: jest.fn().mockResolvedValue('https://signed/x'),
    upload: jest.fn().mockResolvedValue({
      storagePath: 'tenant/document/doc.pdf',
      fileUrl: 'x',
      fileType: 'application/pdf',
    }),
  };
  const audit = {
    log: jest
      .fn<
        Promise<void>,
        [
          Record<string, unknown> & {
            action: string;
            after_data: { assets: unknown };
          },
        ]
      >()
      .mockResolvedValue(undefined),
  };
  const pdf = {
    renderDocument: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
  };
  const verification = { createToken: jest.fn().mockResolvedValue('tok') };
  const config = { get: jest.fn().mockReturnValue('https://app.example.com') };
  const svc = new GenerationService(
    session as never,
    storage as never,
    audit as never,
    new TemplateRenderService(),
    pdf as never,
    verification as never,
    config as never,
  );
  return { svc, calls, storage, audit, pdf, verification };
}

const tenant = new TenantContext('tenant-1', 'branch-1');
const actor: Actor = { userId: 'u1', roles: ['manager'] };
const dto = {
  doc_type: 'quotation' as const,
  source_id: 'manual-1',
  lang: 'en' as const,
  input: {
    customer: { name: 'Buyer Co' },
    items: [{ name: 'Item A', quantity: 2, unit_price: 100 }],
  },
};

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: () =>
      Promise.resolve(
        PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
      ),
  }) as never;
});

describe('computeManualTotals (server-side money)', () => {
  it('exclusive pricing adds VAT on top', () => {
    const r = computeManualTotals(
      [
        { name: 'A', quantity: 2, unit_price: 50 },
        { name: 'B', quantity: 1, unit_price: 250 },
      ],
      0.15,
      false,
      'en',
    );
    expect(r.total).toBe(402.5);
    expect(r.vat).toBe(52.5);
    expect(r.totals.map((t) => t.value)).toEqual([350, 52.5, 402.5]);
  });

  it('inclusive pricing extracts VAT from the lines', () => {
    const r = computeManualTotals(
      [{ name: 'A', quantity: 1, unit_price: 115 }],
      0.15,
      true,
      'en',
    );
    expect(r.total).toBe(115);
    expect(r.vat).toBe(15);
    expect(r.totals[0].value).toBe(100);
  });

  it('has no floating point drift and applies discounts', () => {
    const r = computeManualTotals(
      [{ name: 'A', quantity: 3, unit_price: 0.1 }],
      0,
      false,
      'en',
    );
    expect(r.total).toBe(0.3);
    const d = computeManualTotals(
      [{ name: 'A', quantity: 1, unit_price: 100, discount: 10 }],
      0.15,
      false,
      'en',
    );
    expect(d.total).toBe(103.5);
    expect(d.totals.some((t) => t.label === 'Discount')).toBe(true);
  });

  it('rejects empty, negative and over-discounted lines', () => {
    expect(() => computeManualTotals([], 0.15, false, 'en')).toThrow(
      BadRequestException,
    );
    expect(() =>
      computeManualTotals(
        [{ name: 'A', quantity: 0, unit_price: 1 }],
        0,
        false,
        'en',
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      computeManualTotals(
        [{ name: 'A', quantity: 1, unit_price: 10, discount: 11 }],
        0,
        false,
        'en',
      ),
    ).toThrow(BadRequestException);
  });
});

describe('GenerationService.issue', () => {
  it('issues an immutable snapshot: embedded image, QR, PDF stored, token + audit', async () => {
    const { svc, calls, storage, audit, verification, pdf } = setup();
    const r = await svc.issue(tenant, actor, { ...dto, template_id: TEMPLATE });

    expect(r.document_number).toMatch(/^QT-/);
    expect(r.verification_url).toMatch(
      /^https:\/\/app\.example\.com\/en\/public\/verify\/[A-Za-z0-9_-]{32}$/,
    );

    const ins = calls.find((c) =>
      c.sql.includes('INSERT INTO generated_documents'),
    );
    const html = ins?.params[5] as string;
    expect(html).toContain('data:image/png;base64,'); // image embedded, no expiring URL
    expect(html).not.toContain('https://signed');
    expect(html).toContain('<svg'); // QR
    expect(html).toContain('402.50'.replace('402.50', '230.00')); // 200 + 30 VAT, computed by the backend
    expect(ins?.params[8]).toBe('tenant/document/doc.pdf');
    expect(JSON.parse(ins?.params[7] as string)).toEqual([
      {
        asset_id: ASSET,
        category: 'company_stamp',
        storage_path: 'p/stamp.png',
        mime: 'image/png',
        checksum: 'abc',
      },
    ]);

    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        ownerType: 'document',
        fileType: 'application/pdf',
      }),
    );
    expect(pdf.renderDocument).toHaveBeenCalledTimes(1);
    expect(verification.createToken).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      r.id,
      expect.objectContaining({
        document_number: r.document_number,
        issuer_name: 'Acme',
      }),
      null,
      r.verification_url.split('/').pop(),
    );
    const entry = audit.log.mock.calls[0][0];
    expect(entry.action).toBe('document.issue');
    expect(JSON.stringify(entry)).not.toContain('data:image');
    expect(entry.after_data.assets).toEqual([
      { asset_id: ASSET, category: 'company_stamp' },
    ]);
  });

  it('refuses a stamp/signature template that has no approval', async () => {
    const { svc, storage } = setup({
      answers: [['FROM document_approvals', []]],
    });
    await expect(
      svc.issue(tenant, actor, { ...dto, template_id: TEMPLATE }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('refuses when the approval is older than the published version', async () => {
    const { svc } = setup({
      answers: [
        ['FROM document_templates t', [templateRow({ vcreated: NEW })]],
        [
          'FROM document_approvals',
          [{ decision: 'approved', approved_at: OLD }],
        ],
      ],
    });
    await expect(
      svc.issue(tenant, actor, { ...dto, template_id: TEMPLATE }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses when the latest decision is a rejection', async () => {
    const { svc } = setup({
      answers: [
        [
          'FROM document_approvals',
          [{ decision: 'rejected', approved_at: NEW }],
        ],
      ],
    });
    await expect(
      svc.issue(tenant, actor, { ...dto, template_id: TEMPLATE }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not require approval when no stamp/signature is used', async () => {
    const plain = {
      elements: [{ id: 'h', type: 'heading', config: { text: 'x' } }],
      pages: [{}],
    };
    const { svc } = setup({
      answers: [
        ['FROM document_templates t', [templateRow({ body: plain })]],
        ['FROM document_approvals', []],
      ],
    });
    await expect(
      svc.issue(tenant, actor, { ...dto, template_id: TEMPLATE }),
    ).resolves.toMatchObject({ doc_type: 'quotation' });
  });

  describe('asset permissions', () => {
    it('allows a role that has can_use', async () => {
      const { svc } = setup({
        answers: [
          [
            'FROM document_asset_permissions',
            [{ role_id: ROLE, branch_id: null, can_use: true }],
          ],
        ],
      });
      await expect(
        svc.issue(tenant, actor, { ...dto, template_id: TEMPLATE }),
      ).resolves.toBeDefined();
    });

    it('denies a role that is not listed once restrictions exist', async () => {
      const other = '55555555-5555-4555-8555-555555555555';
      const { svc } = setup({
        answers: [
          [
            'FROM document_asset_permissions',
            [{ role_id: other, branch_id: null, can_use: true }],
          ],
        ],
      });
      await expect(
        svc.issue(tenant, actor, { ...dto, template_id: TEMPLATE }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('an explicit can_use=false wins', async () => {
      const { svc } = setup({
        answers: [
          [
            'FROM document_asset_permissions',
            [
              { role_id: null, branch_id: null, can_use: true },
              { role_id: ROLE, branch_id: null, can_use: false },
            ],
          ],
        ],
      });
      await expect(
        svc.issue(tenant, actor, { ...dto, template_id: TEMPLATE }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a branch grant applies to that branch only', async () => {
      const grant = [{ role_id: null, branch_id: 'branch-1', can_use: true }];
      const ok = setup({
        answers: [['FROM document_asset_permissions', grant]],
      });
      await expect(
        ok.svc.issue(tenant, actor, { ...dto, template_id: TEMPLATE }),
      ).resolves.toBeDefined();
      const bad = setup({
        answers: [['FROM document_asset_permissions', grant]],
      });
      await expect(
        bad.svc.issue(new TenantContext('tenant-1', 'branch-2'), actor, {
          ...dto,
          template_id: TEMPLATE,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('stops (never silently drops) when a used asset is archived or missing', async () => {
    const archived = setup({
      answers: [['FROM document_assets', [assetRow({ status: 'archived' })]]],
    });
    await expect(
      archived.svc.issue(tenant, actor, { ...dto, template_id: TEMPLATE }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const missing = setup({ answers: [['FROM document_assets', []]] });
    await expect(
      missing.svc.issue(tenant, actor, { ...dto, template_id: TEMPLATE }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('only a published template of the same type can be used', async () => {
    const none = setup({ answers: [['FROM document_templates t', []]] });
    await expect(
      none.svc.issue(tenant, actor, { ...dto, template_id: TEMPLATE }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const wrong = setup({
      answers: [
        ['FROM document_templates t', [templateRow({ doc_type: 'receipt' })]],
      ],
    });
    await expect(
      wrong.svc.issue(tenant, actor, { ...dto, template_id: TEMPLATE }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resolves the template: branch assignment, else tenant assignment, else default', async () => {
    const order: string[] = [];
    const s = setup({
      answers: [
        [
          "scope = 'branch'",
          (p) => {
            order.push(`branch:${p[2] as string}`);
            return [{ template_id: TEMPLATE }];
          },
        ],
      ],
    });
    await s.svc.issue(tenant, actor, dto);
    expect(order).toEqual(['branch:branch-1']);

    const none = setup({
      answers: [
        ["scope = 'branch'", []],
        ["scope = 'tenant'", []],
        ['is_default = TRUE', []],
      ],
    });
    await expect(none.svc.issue(tenant, actor, dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses to issue a document whose QR would not scan', async () => {
    const small = {
      pages: [{}],
      elements: [
        {
          id: 'q',
          type: 'qr',
          config: { kind: 'verification' },
          position: { x: 1, y: 1 },
          size: { width: 8, height: 8 },
        },
      ],
    };
    const { svc, storage } = setup({
      answers: [
        ['FROM document_templates t', [templateRow({ body: small })]],
        ['FROM document_assets', []],
      ],
    });
    await expect(
      svc.issue(tenant, actor, { ...dto, template_id: TEMPLATE }),
    ).rejects.toThrow(/too small/);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('manual documents require input; order documents require a sale id', async () => {
    const a = setup();
    await expect(
      a.svc.issue(tenant, actor, {
        ...dto,
        input: undefined,
        template_id: TEMPLATE,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const b = setup({
      answers: [
        ['FROM document_templates t', [templateRow({ doc_type: 'receipt' })]],
      ],
    });
    await expect(
      b.svc.issue(tenant, actor, {
        doc_type: 'receipt',
        source_id: 'not-a-uuid',
        template_id: TEMPLATE,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aborts if the template was republished while issuing', async () => {
    let n = 0;
    const { svc } = setup({
      answers: [
        [
          'FROM document_templates t',
          () =>
            ++n === 1
              ? [templateRow()]
              : [templateRow({ vid: '66666666-6666-4666-8666-666666666666' })],
        ],
      ],
    });
    await expect(
      svc.issue(tenant, actor, { ...dto, template_id: TEMPLATE }),
    ).rejects.toThrow(/republished/);
  });
});

describe('GenerationService void & approvals', () => {
  it('voids an issued document once and audits it', async () => {
    const { svc, audit } = setup({
      answers: [['UPDATE generated_documents', [{ id: 'doc-1' }]]],
    });
    await expect(
      svc.voidDocument(tenant, actor, 'doc-1', { reason: 'mistake' }),
    ).resolves.toEqual({ id: 'doc-1', status: 'void' });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document.void' }),
    );
  });

  it('404s when voiding a document that is not issued/in this tenant', async () => {
    const s = setup();
    (
      s.svc as unknown as { tenantSession: { runInTenantContext: unknown } }
    ).tenantSession = {
      runInTenantContext: (_t: unknown, fn: (c: unknown) => unknown) =>
        fn({ query: () => Promise.resolve({ rows: [], rowCount: 0 }) }),
    };
    await expect(
      s.svc.voidDocument(tenant, actor, 'doc-1', { reason: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('records an approval for a PUBLISHED template and audits it', async () => {
    const { svc, audit, calls } = setup({
      answers: [
        [
          'INSERT INTO document_approvals',
          [{ id: 'a1', decision: 'approved' }],
        ],
      ],
    });
    await svc.createApproval(tenant, actor, {
      template_id: TEMPLATE,
      decision: 'approved',
    });
    const ins = calls.find((c) =>
      c.sql.includes('INSERT INTO document_approvals'),
    );
    expect(ins?.params).toEqual([
      'tenant-1',
      'quotation',
      TEMPLATE,
      'u1',
      'approved',
      null,
    ]);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document.approval.approved' }),
    );
  });

  it('cannot approve a template that is not published', async () => {
    const { svc } = setup({ answers: [['FROM document_templates t', []]] });
    await expect(
      svc.createApproval(tenant, actor, {
        template_id: TEMPLATE,
        decision: 'approved',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
