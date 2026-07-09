import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { PaginationDto } from '../../../shared/dto/pagination.dto';

@Injectable()
export class PurchaseOrdersRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenantId: string, status?: string, pagination: PaginationDto = new PaginationDto()) {
    const { data, error } = await this.supabase.rpc('fn_purchase_orders_list_enriched', {
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
      .from('purchase_orders')
      .select('*, suppliers(name), warehouses(name, code), items:purchase_order_items(*, items(name, sku))')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(
    tenantId: string,
    payload: Record<string, unknown>,
    items: Record<string, unknown>[],
    createdBy: string,
  ) {
    const { data: po, error } = await this.supabase
      .from('purchase_orders')
      .insert({ ...payload, tenant_id: tenantId, created_by: createdBy, status: 'draft' })
      .select()
      .single();
    if (error) throw error;

    const { error: itemsError } = await this.supabase
      .from('purchase_order_items')
      .insert(items.map((i) => ({ ...i, tenant_id: tenantId, purchase_order_id: po.id })));
    if (itemsError) throw itemsError;

    return this.findById(po.id, tenantId);
  }

  async update(id: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('purchase_orders')
      .update(payload)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'draft')
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async submit(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('purchase_orders')
      .update({ status: 'submitted' })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'draft')
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async approve(id: string, tenantId: string, approvedBy: string) {
    const { data, error } = await this.supabase
      .from('purchase_orders')
      .update({ status: 'approved', approved_by: approvedBy, approved_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'submitted')
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async cancel(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('purchase_orders')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .in('status', ['draft', 'submitted', 'approved'])
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async softDelete(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('purchase_orders')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'draft');
    if (error) throw error;
  }
}
