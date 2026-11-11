import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { TenantContext } from '../../../core/tenant/tenant.context';

@Injectable()
export class ItemAttributesRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  private ctx(tenantId: string): TenantContext {
    return { tenantId } as TenantContext;
  }

  // -- Attribute definitions ------------------------------------------------

  async findAllAttributes(tenantId: string) {
    const { data, error } = await this.scopedQuery(
      'item_attributes',
      this.ctx(tenantId),
    )
      .select('id, name, is_active, created_at')
      .is('deleted_at', null)
      .order('name');
    if (error) throw error;
    return data;
  }

  async findAttributeById(id: string, tenantId: string) {
    const { data, error } = await this.scopedQuery(
      'item_attributes',
      this.ctx(tenantId),
    )
      .select('id, name, is_active, created_at')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async createAttribute(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('item_attributes')
      .insert({ ...payload, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async updateAttribute(
    id: string,
    tenantId: string,
    payload: Record<string, unknown>,
  ) {
    const { data, error } = await this.supabase
      .from('item_attributes')
      .update(payload)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // Soft delete, matching the same pattern units/brands (093) already use.
  async deleteAttribute(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('item_attributes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  async countValuesInUse(attributeId: string, tenantId: string) {
    const { count, error } = await this.supabase
      .from('item_variant_attribute_values')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('item_attribute_id', attributeId);
    if (error) throw error;
    return count ?? 0;
  }

  // -- Attribute values -------------------------------------------------------

  async findValuesByAttribute(attributeId: string, tenantId: string) {
    const { data, error } = await this.scopedQuery(
      'item_attribute_values',
      this.ctx(tenantId),
    )
      .select('id, item_attribute_id, value, created_at')
      .eq('item_attribute_id', attributeId)
      .is('deleted_at', null)
      .order('value');
    if (error) throw error;
    return data;
  }

  async findValueById(id: string, tenantId: string) {
    const { data, error } = await this.scopedQuery(
      'item_attribute_values',
      this.ctx(tenantId),
    )
      .select('id, item_attribute_id, value, created_at')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async createValue(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('item_attribute_values')
      .insert({ ...payload, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async updateValue(
    id: string,
    tenantId: string,
    payload: Record<string, unknown>,
  ) {
    const { data, error } = await this.supabase
      .from('item_attribute_values')
      .update(payload)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async deleteValue(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('item_attribute_values')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  // -- Variant assignments ----------------------------------------------------

  async findAssignmentsForVariant(variantId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('item_variant_attribute_values')
      .select(
        `id, item_variant_id, item_attribute_id, item_attribute_value_id,
         item_attributes(id, name),
         item_attribute_values(id, value)`,
      )
      .eq('tenant_id', tenantId)
      .eq('item_variant_id', variantId);
    if (error) throw error;
    return data;
  }

  async upsertAssignment(tenantId: string, payload: Record<string, unknown>) {
    // One row per (item_variant_id, item_attribute_id) — re-assigning a
    // value for the same attribute on the same variant replaces the prior
    // one rather than erroring, since the uq_variant_attribute constraint
    // exists to enforce "one value per attribute," not "immutable once set."
    const { data, error } = await this.supabase
      .from('item_variant_attribute_values')
      .upsert(
        { ...payload, tenant_id: tenantId },
        { onConflict: 'item_variant_id,item_attribute_id' },
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async removeAssignment(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('item_variant_attribute_values')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }
}
