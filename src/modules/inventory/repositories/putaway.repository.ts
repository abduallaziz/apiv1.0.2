import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class PutawayRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAllRules(tenantId: string) {
    const { data, error } = await this.supabase
      .from('putaway_rules')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('priority', { ascending: true });
    if (error) throw error;
    return data;
  }

  async createRule(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('putaway_rules')
      .insert({ ...payload, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async suggestLocation(
    tenantId: string, warehouseId: string, itemId: string, categoryId: string | null, quantity: number,
  ) {
    const { data, error } = await this.supabase.rpc('fn_suggest_putaway_location', {
      p_tenant_id: tenantId, p_warehouse_id: warehouseId, p_item_id: itemId, p_category_id: categoryId, p_quantity: quantity,
    });
    if (error) throw error;
    return data?.[0] ?? null;
  }

  async createTask(tenantId: string, payload: {
    warehouse_id: string; item_id: string; variant_id: string | null; batch_id: string | null;
    quantity: number; source_location_id: string | null; suggested_location_id: string | null;
    source_document_type: string; source_document_id: string | null; created_by: string | null;
  }) {
    const { data, error } = await this.supabase.rpc('fn_create_putaway_task', {
      p_tenant_id: tenantId, p_warehouse_id: payload.warehouse_id, p_item_id: payload.item_id,
      p_variant_id: payload.variant_id, p_batch_id: payload.batch_id, p_quantity: payload.quantity,
      p_source_location_id: payload.source_location_id, p_suggested_location_id: payload.suggested_location_id,
      p_source_document_type: payload.source_document_type, p_source_document_id: payload.source_document_id,
      p_created_by: payload.created_by,
    });
    if (error) throw error;
    return data;
  }
}
