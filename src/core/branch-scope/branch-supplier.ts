import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { currentBranchId } from './branch-warehouse-scope';

/**
 * Suppliers are branch-owned under isolation (suppliers.branch_id, D4). Writes that reference a supplier
 * (purchase orders, quotes, agreements, supplier items) must use a supplier of the working branch.
 * No-op when isolation is off or no supplier is referenced.
 */
export async function assertSupplierInBranch(
  supabase: SupabaseClient,
  tenantId: string,
  supplierId: string | null | undefined,
): Promise<void> {
  const branchId = currentBranchId(tenantId);
  if (!branchId || !supplierId) return;
  const { data, error } = await supabase
    .from('suppliers')
    .select('id, branch_id')
    .eq('id', supplierId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundException('Supplier not found');
  if ((data as { branch_id: string | null }).branch_id !== branchId) {
    throw new ForbiddenException(
      'The supplier belongs to another branch and cannot be used here',
    );
  }
}

/** Ids of the working branch's suppliers, or null when isolation is off. */
export async function branchSupplierIds(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<string[] | null> {
  const branchId = currentBranchId(tenantId);
  if (!branchId) return null;
  const { data, error } = await supabase
    .from('suppliers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .is('deleted_at', null);
  if (error) throw error;
  const ids = (data ?? []).map((r: { id: string }) => r.id);
  return ids.length ? ids : ['00000000-0000-0000-0000-000000000000'];
}
