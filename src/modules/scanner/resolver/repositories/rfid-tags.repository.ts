import { Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

// New master data (migration 175) — Sefay had no RFID mapping before this
// phase. tag_value is unique per tenant, so at most one match is possible;
// kept array-shaped for the same reason every other lookup here is, so the
// pipeline's ambiguity handling is uniform across resolvers even though
// this one can never actually trigger it today.
@Injectable()
export class RfidTagsRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findByTagValue(tagValue: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('item_rfid_tags')
      .select(
        'id, item_id, variant_id, tag_value, items(id, name, is_active), item_variants(id, name, is_active)',
      )
      .eq('tag_value', tagValue)
      .eq('tenant_id', tenantId);
    if (error) throw error;
    return data ?? [];
  }
}
