import { Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

// Read-only lookup for the Resolver Engine. No existing repository queries
// item_batches by batch_number (its only current consumers are goods
// receipt / cost layers, which look it up by id), so this is new code, not
// a duplicate of anything.
@Injectable()
export class BatchesLookupRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  // batch_number is only unique per (tenant, item, variant) — not
  // tenant-wide — so more than one item can share the same batch string.
  // Callers must handle a multi-row result as ambiguous.
  async findByBatchNumber(batchNumber: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('item_batches')
      .select(
        'id, item_id, variant_id, batch_number, expiration_date, items(id, name, is_active), item_variants(id, name, is_active)',
      )
      .eq('batch_number', batchNumber)
      .eq('tenant_id', tenantId);
    if (error) throw error;
    return data ?? [];
  }
}
