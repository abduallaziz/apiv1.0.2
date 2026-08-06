import { Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

// Advisory-only, read-only lookup — mirrors HoldsRepository.checkHolds()
// exactly (same shape: tenant/warehouse/items in, rows out, never throws
// a business error, purely informational for InvoicesService).
@Injectable()
export class ExpiredBatchesRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async checkExpiredBatches(
    tenantId: string,
    warehouseId: string,
    items: { item_id: string; variant_id: string | null }[],
  ) {
    const { data, error } = await this.supabase.rpc('fn_check_expired_batches', {
      p_tenant_id: tenantId,
      p_warehouse_id: warehouseId,
      p_items: items,
    });
    if (error) throw error;
    return data;
  }
}
