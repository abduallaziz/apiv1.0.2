import { SupabaseClient } from '@supabase/supabase-js';

interface WarnLogger {
  warn(message: string): void;
}

/**
 * Every branch must have a usable default warehouse: without one, sale stock
 * deduction is skipped and no COGS is posted (see
 * docs/DESIGN_COGS_POSTING_AFTER_STOCK_DEDUCTION.md). Creates one for the branch
 * (if it has none) and links it as `branches.default_warehouse_id`.
 *
 * Best-effort by design: never throws, so creating a branch/tenant is never
 * blocked by it. Returns the warehouse id, or null if it could not be created
 * (the sale-time warning then makes the gap visible).
 */
export async function ensureBranchWarehouse(
  supabase: SupabaseClient,
  tenantId: string,
  branchId: string,
  branchName: string,
  logger?: WarnLogger,
): Promise<string | null> {
  try {
    const { data: existing } = await supabase
      .from('branches')
      .select('default_warehouse_id')
      .eq('id', branchId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (existing?.default_warehouse_id) {
      return existing.default_warehouse_id as string;
    }

    // `code` is unique per tenant among live warehouses; the branch id makes it so.
    const code = `WH-${branchId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const { data: warehouse, error } = await supabase
      .from('warehouses')
      .insert({
        tenant_id: tenantId,
        branch_id: branchId,
        code,
        name: `Warehouse - ${branchName}`.slice(0, 120),
        is_active: true,
      })
      .select('id')
      .single();
    if (error || !warehouse) throw error ?? new Error('warehouse not created');

    const { error: linkError } = await supabase
      .from('branches')
      .update({ default_warehouse_id: warehouse.id })
      .eq('id', branchId)
      .eq('tenant_id', tenantId);
    if (linkError) throw linkError;

    return warehouse.id as string;
  } catch (err) {
    logger?.warn(
      `Could not create the default warehouse for branch ${branchId}: ${
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err)
      }`,
    );
    return null;
  }
}
