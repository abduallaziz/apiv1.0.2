import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { TenantContext } from '../../../core/tenant/tenant.context';

@Injectable()
export class ItemBarcodesRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  private ctx(tenantId: string): TenantContext {
    return { tenantId } as TenantContext;
  }

  async findAll(tenantId: string, itemId?: string, variantId?: string) {
    let query = this.scopedQuery('item_barcodes', this.ctx(tenantId))
      .select(
        'id, item_id, variant_id, barcode, barcode_type, is_primary, created_at, updated_at',
      )
      .order('created_at');

    if (itemId) query = query.eq('item_id', itemId);
    if (variantId) query = query.eq('variant_id', variantId);

    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.scopedQuery(
      'item_barcodes',
      this.ctx(tenantId),
    )
      .select(
        'id, item_id, variant_id, barcode, barcode_type, is_primary, created_at, updated_at',
      )
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findByBarcode(barcode: string, tenantId: string) {
    const { data, error } = await this.scopedQuery(
      'item_barcodes',
      this.ctx(tenantId),
    )
      .select('id, item_id, variant_id, barcode, barcode_type, is_primary')
      .eq('barcode', barcode)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // POS/lookup path: one round trip from a scanned barcode straight to the
  // sellable item (+ variant, if the barcode is variant-specific), joined
  // via Supabase's nested select — same pattern already used by
  // ItemsRepository.findById for categories/item_variants joins.
  async lookupByBarcode(barcode: string, tenantId: string) {
    const { data, error } = await this.scopedQuery(
      'item_barcodes',
      this.ctx(tenantId),
    )
      .select(
        `id, barcode, barcode_type, is_primary, item_id, variant_id,
         items(id, name, type, price, has_inventory, has_variants, is_active),
         item_variants(id, name, price_adjustment, sku, is_active)`,
      )
      .eq('barcode', barcode)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('item_barcodes')
      .insert({ ...payload, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('item_barcodes')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async delete(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('item_barcodes')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  // Atomic per-tenant sequence backing auto-generated barcodes — see
  // migration 101. A single UPSERT...RETURNING under the hood, so
  // concurrent callers for the same tenant (e.g. two POS terminals
  // creating items simultaneously) never receive the same value.
  async nextSequence(tenantId: string): Promise<number> {
    const { data, error } = await this.supabase.rpc('fn_next_barcode_seq', {
      p_tenant_id: tenantId,
    });
    if (error) throw error;
    return data as number;
  }

  async hasPrimaryForItem(
    tenantId: string,
    itemId: string,
    variantId: string | null,
  ): Promise<boolean> {
    let query = this.supabase
      .from('item_barcodes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('item_id', itemId)
      .eq('is_primary', true)
      .is('deleted_at', null);

    query = variantId
      ? query.eq('variant_id', variantId)
      : query.is('variant_id', null);

    const { count, error } = await query;
    if (error) throw error;
    return (count ?? 0) > 0;
  }

  // Clears is_primary on every other barcode for the same item/variant —
  // used before setting a new primary so exactly one stays true.
  async clearPrimaryForItem(
    tenantId: string,
    itemId: string,
    variantId: string | null,
    exceptId?: string,
  ) {
    let query = this.supabase
      .from('item_barcodes')
      .update({ is_primary: false, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('item_id', itemId)
      .eq('is_primary', true);

    query = variantId
      ? query.eq('variant_id', variantId)
      : query.is('variant_id', null);
    if (exceptId) query = query.neq('id', exceptId);

    const { error } = await query;
    if (error) throw error;
  }
}
