import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { TenantContext } from '../../../core/tenant/tenant.context';

@Injectable()
export class ItemPackagingLevelsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  private ctx(tenantId: string): TenantContext {
    return { tenantId } as TenantContext;
  }

  async findAllForItem(itemId: string, tenantId: string) {
    const { data, error } = await this.scopedQuery(
      'item_packaging_levels',
      this.ctx(tenantId),
    )
      .select(
        'id, item_id, parent_level_id, level_name, quantity_in_parent, created_at',
      )
      .eq('item_id', itemId)
      .order('created_at');
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.scopedQuery(
      'item_packaging_levels',
      this.ctx(tenantId),
    )
      .select(
        'id, item_id, parent_level_id, level_name, quantity_in_parent, created_at',
      )
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findRootForItem(itemId: string, tenantId: string) {
    const { data, error } = await this.scopedQuery(
      'item_packaging_levels',
      this.ctx(tenantId),
    )
      .select('id, level_name')
      .eq('item_id', itemId)
      .is('parent_level_id', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('item_packaging_levels')
      .insert({ ...payload, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('item_packaging_levels')
      .update(payload)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // Cascades to descendant levels and their barcodes at the DB level
  // (ON DELETE CASCADE, migration 221) — the caller is responsible for
  // deciding whether that's acceptable before calling this (dependency
  // protection lives in the service layer).
  async delete(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('item_packaging_levels')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  async hasChildren(id: string, tenantId: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('item_packaging_levels')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('parent_level_id', id);
    if (error) throw error;
    return (count ?? 0) > 0;
  }

  async hasBarcodes(id: string, tenantId: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('item_barcodes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('packaging_level_id', id);
    if (error) throw error;
    return (count ?? 0) > 0;
  }

  // Delegates to fn_convert_packaging_to_storage_qty (migration 221) — the
  // single authoritative resolver, never reimplemented client-side, so a
  // hierarchy edit can never silently desync backend RPC math from
  // TypeScript math.
  async resolveToStorageQty(
    itemId: string,
    packagingLevelId: string | null | undefined,
    quantity: number,
  ): Promise<number> {
    if (!packagingLevelId) return quantity;
    const { data, error } = await this.supabase.rpc(
      'fn_convert_packaging_to_storage_qty',
      {
        p_item_id: itemId,
        p_packaging_level_id: packagingLevelId,
        p_quantity: quantity,
      },
    );
    if (error) throw error;
    return Number(data);
  }
}
