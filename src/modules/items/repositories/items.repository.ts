import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { TenantContext } from '../../../core/tenant/tenant.context';
import { PaginationDto } from '../../../shared/dto/pagination.dto';

@Injectable()
export class ItemsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  private ctx(tenantId: string): TenantContext {
    return { tenantId } as TenantContext;
  }

  private flattenItem(item: any) {
    const { categories, item_variants, ...rest } = item;
    return {
      ...rest,
      category_id: categories?.id ?? null,
      category_name: categories?.name ?? null,
      category_type: categories?.type ?? null,
      variants_count: item_variants?.length ?? 0,
    };
  }

  async findAll(tenantId: string, pagination: PaginationDto = new PaginationDto()) {
    const [from, to] = pagination.range;
    const { data, error } = await this.scopedQuery('items', this.ctx(tenantId))
      .select(
        `id, name, type, operation_type, price, has_inventory, has_variants, is_active, created_at,
         categories(id, name, type),
         item_variants(id)`,
      )
      .eq('is_active', true)
      .order('name')
      .range(from, to);
    if (error) throw error;
    return (data ?? []).map(this.flattenItem.bind(this));
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.scopedQuery('items', this.ctx(tenantId))
      .select(
        `id, name, type, operation_type, price, has_inventory, has_variants, is_active, created_at,
         categories(id, name, type),
         item_variants(id, name, price_adjustment, sku, stock_quantity, is_active)`,
      )
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? this.flattenItem(data) : null;
  }

  async create(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('items')
      .insert({ ...payload, tenant_id: tenantId, is_active: true })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('items')
      .update(payload)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async softDelete(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('items')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  async findVariants(itemId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('item_variants')
      .select('id, name, price_adjustment, sku, stock_quantity, is_active')
      .eq('item_id', itemId)
      .eq('tenant_id', tenantId)
      .eq('is_active', true);
    if (error) throw error;
    return data;
  }

  async createVariant(itemId: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('item_variants')
      .insert({ ...payload, item_id: itemId, tenant_id: tenantId, is_active: true })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async updateVariant(
    variantId: string,
    itemId: string,
    tenantId: string,
    payload: Record<string, unknown>,
  ) {
    const { data, error } = await this.supabase
      .from('item_variants')
      .update(payload)
      .eq('id', variantId)
      .eq('item_id', itemId)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async softDeleteVariant(variantId: string, itemId: string, tenantId: string) {
    const { error } = await this.supabase
      .from('item_variants')
      .update({ is_active: false })
      .eq('id', variantId)
      .eq('item_id', itemId)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }
}