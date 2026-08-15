import { ConflictException, Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { isUniqueViolation } from '../../../shared/supabase/postgrest-error.util';

function toHttpError(error: unknown): unknown {
  if (isUniqueViolation(error)) {
    return new ConflictException(
      'A configuration for this supplier/item/variant already exists',
    );
  }
  return error;
}

@Injectable()
export class SupplierItemsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenantId: string, supplierId: string) {
    const { data, error } = await this.supabase
      .from('supplier_items')
      .select('*, items(name, sku), item_variants(name, sku)')
      .eq('tenant_id', tenantId)
      .eq('supplier_id', supplierId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string, supplierId: string) {
    const { data, error } = await this.supabase
      .from('supplier_items')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('supplier_id', supplierId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(
    tenantId: string,
    supplierId: string,
    payload: Record<string, unknown>,
  ) {
    const { data, error } = await this.supabase
      .from('supplier_items')
      .insert({ ...payload, tenant_id: tenantId, supplier_id: supplierId })
      .select()
      .single();
    if (error) throw toHttpError(error);
    return data;
  }

  async update(
    id: string,
    tenantId: string,
    supplierId: string,
    payload: Record<string, unknown>,
  ) {
    const { data, error } = await this.supabase
      .from('supplier_items')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('supplier_id', supplierId)
      .select()
      .maybeSingle();
    if (error) throw toHttpError(error);
    return data;
  }

  async remove(id: string, tenantId: string, supplierId: string) {
    const { error } = await this.supabase
      .from('supplier_items')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('supplier_id', supplierId);
    if (error) throw error;
  }
}
