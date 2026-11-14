import {
  EntityPublisher,
  PublishContext,
  PublishRow,
} from '../branch-publish.types';

export interface SimplePublisherConfig {
  type: string;
  group: EntityPublisher['group'];
  labelAr: string;
  labelEn: string;
  table: string;
  /** Columns copied verbatim from the source row (tenant_id / branch_id / id are never copied). */
  columns: string[];
  /** Natural key used to match an existing row in the target branch. */
  naturalKey: { column: string; caseInsensitive?: boolean };
  /** Table has a deleted_at column (default true). */
  softDelete?: boolean;
  /** Table has an updated_at column (default true; categories/brands/units do not). */
  hasUpdatedAt?: boolean;
  /** Extra columns forced on every created/updated row (e.g. reset counters). */
  overrides?: (targetBranchId: string) => Record<string, unknown>;
}

/** Escapes % _ \ for ILIKE so a name is matched literally. */
export function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Pick the configured columns from a source row. */
export function pickColumns(
  row: PublishRow,
  columns: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of columns) {
    if (row[c] !== undefined) out[c] = row[c];
  }
  return out;
}

/** Publisher for flat, branch-owned lookup/definition tables with a natural key. */
export function simplePublisher(cfg: SimplePublisherConfig): EntityPublisher {
  const soft = cfg.softDelete !== false;

  const base = (ctx: PublishContext, branchId: string) => {
    let q = ctx.db
      .from(cfg.table)
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('branch_id', branchId);
    if (soft) q = q.is('deleted_at', null);
    return q;
  };

  return {
    type: cfg.type,
    group: cfg.group,
    labelAr: cfg.labelAr,
    labelEn: cfg.labelEn,
    supported: true,

    async loadSources(ctx, ids) {
      const { data, error } = await base(ctx, ctx.sourceBranchId).in('id', ids);
      if (error) throw error;
      return (data ?? []) as PublishRow[];
    },

    async listSourceIds(ctx) {
      const { data, error } = await base(ctx, ctx.sourceBranchId);
      if (error) throw error;
      return ((data ?? []) as { id: string }[]).map((r) => r.id);
    },

    async findExisting(ctx, row, targetBranchId) {
      const value = row[cfg.naturalKey.column];
      if (value === null || value === undefined || value === '') return null;
      let q = ctx.db
        .from(cfg.table)
        .select('id')
        .eq('tenant_id', ctx.tenantId)
        .eq('branch_id', targetBranchId);
      if (soft) q = q.is('deleted_at', null);
      q = cfg.naturalKey.caseInsensitive
        ? q.ilike(cfg.naturalKey.column, escapeLike(String(value)))
        : q.eq(cfg.naturalKey.column, value);
      const { data, error } = await q.limit(1);
      if (error) throw error;
      return data?.[0]?.id ?? null;
    },

    async exists(ctx, targetId, targetBranchId) {
      const { data, error } = await base(ctx, targetBranchId)
        .eq('id', targetId)
        .limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    },

    async create(ctx, row, targetBranchId) {
      const { data, error } = await ctx.db
        .from(cfg.table)
        .insert({
          ...pickColumns(row, cfg.columns),
          ...(cfg.overrides?.(targetBranchId) ?? {}),
          tenant_id: ctx.tenantId,
          branch_id: targetBranchId,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data.id;
    },

    async update(ctx, row, targetId, targetBranchId) {
      const patch: Record<string, unknown> = {
        ...pickColumns(row, cfg.columns),
        ...(cfg.overrides?.(targetBranchId) ?? {}),
      };
      if (cfg.hasUpdatedAt !== false)
        patch.updated_at = new Date().toISOString();
      const { error } = await ctx.db
        .from(cfg.table)
        .update(patch)
        .eq('id', targetId)
        .eq('tenant_id', ctx.tenantId)
        .eq('branch_id', targetBranchId);
      if (error) throw error;
    },
  };
}
