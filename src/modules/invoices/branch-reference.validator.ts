import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { TenantContext } from '../../core/tenant/tenant-context';

export interface BranchReferences {
  itemIds?: Array<string | null | undefined>;
  variantIds?: Array<string | null | undefined>;
  customerId?: string | null;
  couponCode?: string | null;
  workerIds?: Array<string | null | undefined>;
  tableId?: string | null;
  warehouseId?: string | null;
}

type Row = { id: string; branch_id?: string | null };

/**
 * Branch isolation (design D4/D10): a sale / return / dine-in / wash order may only reference records of
 * its own branch. Writes the check defensively: a missing `branch_id` column (another task's migration not
 * applied yet) or a NULL value means "legacy row owned by the main branch". No-op when the tenant does
 * not run with branch isolation, so flag-off behaviour is unchanged.
 */
@Injectable()
export class BranchReferenceValidator {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

  async assertSameBranch(
    tenant: TenantContext,
    branchId: string,
    refs: BranchReferences,
  ): Promise<void> {
    if (!tenant.isolated || !tenant.tenantId) return;
    const isMain = await this.isMainBranch(tenant.tenantId, branchId);
    const tid = tenant.tenantId;

    await Promise.all([
      this.checkIds('items', 'item', tid, branchId, isMain, refs.itemIds, false),
      this.checkIds('item_variants', 'variant', tid, branchId, isMain, refs.variantIds, false),
      this.checkIds('customers', 'customer', tid, branchId, isMain, [refs.customerId], false),
      // central users (NULL branch) may legitimately be a worker
      this.checkIds('users', 'worker', tid, branchId, isMain, refs.workerIds, true),
      this.checkIds('tables', 'table', tid, branchId, isMain, [refs.tableId], false),
      this.checkIds('warehouses', 'warehouse', tid, branchId, isMain, [refs.warehouseId], false),
      this.checkCoupon(tid, branchId, isMain, refs.couponCode),
    ]);
  }

  private async isMainBranch(tenantId: string, branchId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('branches')
      .select('is_main')
      .eq('id', branchId)
      .eq('tenant_id', tenantId)
      .maybeSingle<{ is_main: boolean }>();
    return !!data?.is_main;
  }

  private owns(row: Row, branchId: string, isMain: boolean, nullIsShared: boolean): boolean {
    if (row.branch_id === undefined) return true; // column missing -> legacy
    if (row.branch_id === null) return nullIsShared || isMain;
    return row.branch_id === branchId;
  }

  private async fetchRows(
    table: string,
    tenantId: string,
    ids: string[],
  ): Promise<Row[]> {
    let res = await this.supabase
      .from(table)
      .select('id, branch_id')
      .eq('tenant_id', tenantId)
      .in('id', ids);
    if (res.error) {
      // branch_id column not present yet: fall back to legacy (everything is main-owned)
      res = await this.supabase
        .from(table)
        .select('id')
        .eq('tenant_id', tenantId)
        .in('id', ids);
      if (res.error) throw res.error;
    }
    return (res.data ?? []) as unknown as Row[];
  }

  private async checkIds(
    table: string,
    label: string,
    tenantId: string,
    branchId: string,
    isMain: boolean,
    raw: Array<string | null | undefined> | undefined,
    nullIsShared: boolean,
  ): Promise<void> {
    const ids = [...new Set((raw ?? []).filter((x): x is string => !!x))];
    if (ids.length === 0) return;
    const rows = await this.fetchRows(table, tenantId, ids);
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) {
      const row = byId.get(id);
      // unknown ids are reported by the regular validation of the caller; only foreign ones are rejected here
      if (row && !this.owns(row, branchId, isMain, nullIsShared)) {
        throw new BadRequestException({
          message: `The ${label} belongs to another branch`,
          reasonCode: 'cross_branch_reference',
          reference: label,
          id,
        });
      }
    }
  }

  private async checkCoupon(
    tenantId: string,
    branchId: string,
    isMain: boolean,
    code: string | null | undefined,
  ): Promise<void> {
    if (!code) return;
    let res = await this.supabase
      .from('coupons')
      .select('id, branch_id')
      .eq('tenant_id', tenantId)
      .ilike('code', code.trim());
    if (res.error) {
      res = await this.supabase
        .from('coupons')
        .select('id')
        .eq('tenant_id', tenantId)
        .ilike('code', code.trim());
      if (res.error) throw res.error;
    }
    const rows = (res.data ?? []) as unknown as Row[];
    if (rows.length === 0) return; // normal coupon validation reports "not found"
    // per-branch codes may repeat across branches: valid if ANY row belongs to this branch
    if (!rows.some((r) => this.owns(r, branchId, isMain, false))) {
      throw new BadRequestException({
        message: 'The coupon belongs to another branch',
        reasonCode: 'cross_branch_reference',
        reference: 'coupon',
      });
    }
  }
}
