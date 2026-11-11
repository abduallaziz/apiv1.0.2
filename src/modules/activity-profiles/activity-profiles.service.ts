import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import {
  ACTIVITY_BY_CODE,
  ActivityDefinition,
  ActivityStockMode,
  ActivityWorkflow,
} from './activity-catalog';

export interface ResolvedActivityProfile {
  /** where the activity list came from */
  source: 'branch' | 'tenant' | 'legacy' | 'none';
  /** true when the activity tables (migrations 264/265) are present */
  tables_available: boolean;
  primary: string | null;
  activities: Array<{
    code: string;
    section: string;
    name_en: string;
    is_primary: boolean;
  }>;
  workflow: ActivityWorkflow;
  stock_mode: ActivityStockMode;
  capabilities: string[];
  payment_modes: string[];
  pricing_dimensions: unknown[];
  customer_fields: unknown[];
}

interface ActivityRow {
  activity_code: string;
  is_primary?: boolean;
  is_default?: boolean;
  config_overrides?: Record<string, unknown> | null;
}

const OVERRIDABLE = [
  'workflow',
  'stock_mode',
  'capabilities',
  'payment_modes',
  'pricing_dimensions',
  'customer_fields',
] as const;

/** PostgREST / Postgres signals for "this table does not exist (yet)". */
function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST205' || error?.code === '42P01';
}

@Injectable()
export class ActivityProfilesService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  /**
   * Effective activity profile of a tenant, optionally narrowed to a branch.
   * Order: branch_activities -> tenant_activities -> legacy tenants.activity.
   * Works before migrations 264/265 are applied (falls back to the built-in
   * catalog and the legacy column), so the API can ship ahead of the schema.
   */
  async resolve(
    tenantId: string,
    branchId?: string | null,
  ): Promise<ResolvedActivityProfile> {
    if (branchId) await this.assertBranchInTenant(tenantId, branchId);

    let tablesAvailable = true;
    let source: ResolvedActivityProfile['source'] = 'none';
    let rows: ActivityRow[] = [];

    if (branchId) {
      const r = await this.fetchRows('branch_activities', tenantId, branchId);
      if (r.missing) tablesAvailable = false;
      else if (r.rows.length) {
        rows = r.rows;
        source = 'branch';
      }
    }
    if (!rows.length && tablesAvailable) {
      const r = await this.fetchRows('tenant_activities', tenantId);
      if (r.missing) tablesAvailable = false;
      else if (r.rows.length) {
        rows = r.rows;
        source = 'tenant';
      }
    }
    if (!rows.length) {
      const legacy = await this.legacyActivity(tenantId);
      if (legacy) {
        rows = [{ activity_code: legacy, is_primary: true }];
        source = 'legacy';
      }
    }

    return this.build(rows, source, tablesAvailable);
  }

  private build(
    rows: ActivityRow[],
    source: ResolvedActivityProfile['source'],
    tablesAvailable: boolean,
  ): ResolvedActivityProfile {
    const known = rows.filter((r) => ACTIVITY_BY_CODE.has(r.activity_code));
    const primaryRow =
      known.find((r) => r.is_primary || r.is_default) ?? known[0] ?? null;

    const effective = (row: ActivityRow): ActivityDefinition => {
      const base = ACTIVITY_BY_CODE.get(row.activity_code) as ActivityDefinition;
      const merged = { ...base } as unknown as Record<string, unknown>;
      const o = row.config_overrides ?? {};
      for (const key of OVERRIDABLE) {
        if (o[key] !== undefined) merged[key] = o[key];
      }
      return merged as unknown as ActivityDefinition;
    };

    const defs = known.map(effective);
    const primaryDef = primaryRow ? effective(primaryRow) : null;
    const union = (pick: (d: ActivityDefinition) => string[]) => [
      ...new Set(defs.flatMap(pick)),
    ];

    return {
      source,
      tables_available: tablesAvailable,
      primary: primaryRow?.activity_code ?? null,
      activities: defs.map((d) => ({
        code: d.code,
        section: d.section,
        name_en: d.name_en,
        is_primary: d.code === primaryRow?.activity_code,
      })),
      workflow: primaryDef?.workflow ?? 'instant',
      stock_mode: primaryDef?.stock_mode ?? 'qty',
      capabilities: union((d) => d.capabilities),
      payment_modes: defs.length ? union((d) => d.payment_modes) : ['standard'],
      pricing_dimensions: primaryDef?.pricing_dimensions ?? [],
      customer_fields: primaryDef?.customer_fields ?? [],
    };
  }

  private async fetchRows(
    table: 'branch_activities' | 'tenant_activities',
    tenantId: string,
    branchId?: string,
  ): Promise<{ rows: ActivityRow[]; missing: boolean }> {
    const cols =
      table === 'branch_activities'
        ? 'activity_code, is_default, config_overrides'
        : 'activity_code, is_primary, config_overrides';
    let q = this.supabase
      .from(table)
      .select(cols)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);
    if (branchId) q = q.eq('branch_id', branchId);
    const { data, error } = await q.order('created_at', { ascending: true });
    if (isMissingTable(error)) return { rows: [], missing: true };
    if (error) throw error;
    return { rows: (data ?? []) as unknown as ActivityRow[], missing: false };
  }

  private async legacyActivity(tenantId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('tenants')
      .select('activity')
      .eq('id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return (data?.activity as string | null) ?? null;
  }

  private async assertBranchInTenant(tenantId: string, branchId: string) {
    const { data, error } = await this.supabase
      .from('branches')
      .select('id')
      .eq('id', branchId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Branch not found');
  }
}
