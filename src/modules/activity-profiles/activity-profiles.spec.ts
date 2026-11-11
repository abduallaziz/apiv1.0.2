import * as fs from 'fs';
import * as path from 'path';
import { NotFoundException } from '@nestjs/common';
import { ACTIVITY_CATALOG, ACTIVITY_BY_CODE } from './activity-catalog';
import { ActivityProfilesService } from './activity-profiles.service';

describe('activity catalog', () => {
  it('has 38 unique activities including tireOil', () => {
    expect(ACTIVITY_CATALOG).toHaveLength(38);
    expect(new Set(ACTIVITY_CATALOG.map((a) => a.code)).size).toBe(38);
    expect(ACTIVITY_BY_CODE.has('tireOil')).toBe(true);
  });

  it('covers every activity the web onboarding offers', () => {
    const wizard = path.resolve(
      __dirname,
      '../../../../web/src/features/onboarding/pages/OnboardingWizard.tsx',
    );
    if (!fs.existsSync(wizard)) return; // web repo not checked out (CI)
    const src = fs.readFileSync(wizard, 'utf8');
    const block = src.slice(src.indexOf('ACTIVITY_SECTIONS'), src.indexOf('SECTION_ICONS'));
    const codes = [...block.matchAll(/'([a-zA-Z]+)'/g)]
      .map((m) => m[1])
      .filter((c) => ACTIVITY_BY_CODE.has(c) || /^[a-z]+[A-Za-z]*$/.test(c));
    const sections = ['restaurants', 'retail', 'fashion', 'health', 'beauty', 'services', 'electronics', 'home', 'items', 'key'];
    for (const c of codes.filter((x) => !sections.includes(x))) {
      expect(ACTIVITY_BY_CODE.has(c)).toBe(true);
    }
  });

  it('matches the seed of migration 264 exactly (code, section, workflow, stock mode, capabilities)', () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, '../../database/migrations_pending/264_activity_definitions.sql'),
      'utf8',
    );
    const rows = [
      ...sql.matchAll(
        /\('([a-zA-Z]+)','([a-z]+)','([^']+)',\d+,'([a-z_]+)','([a-z_]+)','\{([^}]*)\}'\)/g,
      ),
    ];
    expect(rows).toHaveLength(38);
    for (const [, code, section, name, workflow, stock, caps] of rows) {
      const def = ACTIVITY_BY_CODE.get(code);
      expect(def).toBeDefined();
      expect(def).toMatchObject({
        section,
        name_en: name,
        workflow,
        stock_mode: stock,
        capabilities: caps.split(','),
      });
    }
  });
});

// Minimal fake of the supabase calls the resolver makes.
type TableResult = { data?: unknown; error?: { code?: string } | null };
function fakeSupabase(tables: Record<string, TableResult>) {
  const from = (table: string) => {
    const result = tables[table] ?? { data: [], error: null };
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'order']) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    q.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: result.data ?? [], error: result.error ?? null }).then(res);
    return q;
  };
  return { from } as never;
}
const MISSING = { error: { code: 'PGRST205' } };

describe('ActivityProfilesService.resolve', () => {
  it('falls back to the legacy tenants.activity before migrations exist', async () => {
    const svc = new ActivityProfilesService(
      fakeSupabase({
        branch_activities: MISSING,
        tenant_activities: MISSING,
        tenants: { data: { activity: 'carWash' } },
      }),
    );
    const p = await svc.resolve('t1');
    expect(p.source).toBe('legacy');
    expect(p.tables_available).toBe(false);
    expect(p.primary).toBe('carWash');
    expect(p.workflow).toBe('queue');
    expect(p.capabilities).toContain('queue');
  });

  it('returns a generic profile for a tenant with no activity at all', async () => {
    const svc = new ActivityProfilesService(
      fakeSupabase({ tenant_activities: { data: [] }, tenants: { data: { activity: null } } }),
    );
    const p = await svc.resolve('t1');
    expect(p.source).toBe('none');
    expect(p.primary).toBeNull();
    expect(p.workflow).toBe('instant');
    expect(p.stock_mode).toBe('qty');
    expect(p.activities).toEqual([]);
  });

  it('merges several tenant activities; capabilities are the union, primary decides workflow', async () => {
    const svc = new ActivityProfilesService(
      fakeSupabase({
        tenant_activities: {
          data: [
            { activity_code: 'supermarket', is_primary: true },
            { activity_code: 'carWash', is_primary: false },
          ],
        },
      }),
    );
    const p = await svc.resolve('t1');
    expect(p.source).toBe('tenant');
    expect(p.primary).toBe('supermarket');
    expect(p.workflow).toBe('instant');
    expect(p.stock_mode).toBe('batch_expiry');
    expect(p.capabilities).toEqual(expect.arrayContaining(['barcode', 'queue', 'vehicles']));
    expect(p.activities.map((a) => a.code)).toEqual(['supermarket', 'carWash']);
  });

  it('a branch with its own activities overrides the tenant ones', async () => {
    const svc = new ActivityProfilesService(
      fakeSupabase({
        branches: { data: { id: 'b1' } },
        branch_activities: { data: [{ activity_code: 'barber', is_default: true }] },
        tenant_activities: { data: [{ activity_code: 'supermarket', is_primary: true }] },
      }),
    );
    const p = await svc.resolve('t1', 'b1');
    expect(p.source).toBe('branch');
    expect(p.primary).toBe('barber');
    expect(p.workflow).toBe('appointment');
  });

  it('a branch without rows inherits the tenant activities', async () => {
    const svc = new ActivityProfilesService(
      fakeSupabase({
        branches: { data: { id: 'b1' } },
        branch_activities: { data: [] },
        tenant_activities: { data: [{ activity_code: 'pharmacy', is_primary: true }] },
      }),
    );
    expect((await svc.resolve('t1', 'b1')).source).toBe('tenant');
  });

  it('applies whitelisted config overrides only', async () => {
    const svc = new ActivityProfilesService(
      fakeSupabase({
        tenant_activities: {
          data: [
            {
              activity_code: 'supermarket',
              is_primary: true,
              config_overrides: { workflow: 'queue', code: 'hacked', section: 'x' },
            },
          ],
        },
      }),
    );
    const p = await svc.resolve('t1');
    expect(p.workflow).toBe('queue');
    expect(p.primary).toBe('supermarket');
    expect(p.activities[0].section).toBe('retail');
  });

  it('ignores unknown activity codes instead of failing', async () => {
    const svc = new ActivityProfilesService(
      fakeSupabase({
        tenant_activities: {
          data: [{ activity_code: 'nope' }, { activity_code: 'cafe', is_primary: true }],
        },
      }),
    );
    const p = await svc.resolve('t1');
    expect(p.activities.map((a) => a.code)).toEqual(['cafe']);
    expect(p.workflow).toBe('table_kitchen');
  });

  it('rejects a branch that is not in the tenant', async () => {
    const svc = new ActivityProfilesService(fakeSupabase({ branches: { data: null } }));
    await expect(svc.resolve('t1', 'foreign')).rejects.toThrow(NotFoundException);
  });
});
