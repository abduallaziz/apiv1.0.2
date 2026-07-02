import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { PaginationDto } from '../../../shared/dto/pagination.dto';

@Injectable()
export class TransfersRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenantId: string, status?: string, pagination: PaginationDto = new PaginationDto()) {
    const { data, error } = await this.supabase.rpc('fn_stock_transfers_list_enriched', {
      p_tenant_id: tenantId,
      p_status: status ?? null,
      p_limit: pagination.perPage,
      p_offset: pagination.offset,
    });
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('stock_transfers')
      .select(
        '*, from:warehouses!stock_transfers_from_warehouse_id_fkey(name,code), to:warehouses!stock_transfers_to_warehouse_id_fkey(name,code), items:stock_transfer_items(*, items(name, sku))',
      )
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();
    if (error) throw error;
    return data;
  }

  async create(tenantId: string, payload: Record<string, unknown>, items: Record<string, unknown>[]) {
    const { data: transfer, error } = await this.supabase
      .from('stock_transfers')
      .insert({ ...payload, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw error;

    const { error: itemsError } = await this.supabase
      .from('stock_transfer_items')
      .insert(items.map((i) => ({ ...i, tenant_id: tenantId, stock_transfer_id: transfer.id })));
    if (itemsError) throw itemsError;

    return this.findById(transfer.id, tenantId);
  }

  async dispatch(transferId: string, actorId: string) {
    const { data, error } = await this.supabase.rpc('fn_transfer_dispatch', {
      p_transfer_id: transferId,
      p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }

  async receive(transferId: string, actorId: string) {
    const { data, error } = await this.supabase.rpc('fn_transfer_receive', {
      p_transfer_id: transferId,
      p_actor_id: actorId,
    });
    if (error) throw error;
    return data;
  }

  async cancel(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('stock_transfers')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'draft')
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}
