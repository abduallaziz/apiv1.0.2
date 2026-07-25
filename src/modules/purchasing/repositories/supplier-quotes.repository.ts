import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupplierQuotesRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAllForRfq(rfqId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('quote_groups')
      .select(
        '*, suppliers(name), quotes:supplier_quotes(*, items:supplier_quote_items(*, items(name, sku)))',
      )
      .eq('rfq_id', rfqId)
      .eq('tenant_id', tenantId);
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('supplier_quotes')
      .select(
        '*, quote_groups(rfq_id, supplier_id, suppliers(name)), items:supplier_quote_items(*, items(name, sku))',
      )
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findQuoteItemById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('supplier_quote_items')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findOrCreateGroup(tenantId: string, rfqId: string, supplierId: string) {
    const { data: existing, error: findError } = await this.supabase
      .from('quote_groups')
      .select('*')
      .eq('rfq_id', rfqId)
      .eq('supplier_id', supplierId)
      .maybeSingle();
    if (findError) throw findError;
    if (existing) return existing;

    const { data: created, error: createError } = await this.supabase
      .from('quote_groups')
      .insert({ tenant_id: tenantId, rfq_id: rfqId, supplier_id: supplierId })
      .select()
      .single();
    if (createError) throw createError;
    return created;
  }

  async findLatestVersion(quoteGroupId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('supplier_quotes')
      .select('*')
      .eq('quote_group_id', quoteGroupId)
      .eq('tenant_id', tenantId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async supersede(quoteId: string, tenantId: string) {
    const { error } = await this.supabase
      .from('supplier_quotes')
      .update({ status: 'superseded' })
      .eq('id', quoteId)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  async create(
    tenantId: string,
    quoteGroupId: string,
    version: number,
    payload: Record<string, unknown>,
    items: Record<string, unknown>[],
    createdBy: string,
  ) {
    const { data: quote, error } = await this.supabase
      .from('supplier_quotes')
      .insert({
        ...payload,
        tenant_id: tenantId,
        quote_group_id: quoteGroupId,
        version,
        created_by: createdBy,
        status: 'draft',
      })
      .select()
      .single();
    if (error) throw error;

    const { error: itemsError } = await this.supabase
      .from('supplier_quote_items')
      .insert(
        items.map((i) => ({
          ...i,
          tenant_id: tenantId,
          supplier_quote_id: quote.id,
        })),
      );
    if (itemsError) throw itemsError;

    return this.findById(quote.id, tenantId);
  }

  async submit(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('supplier_quotes')
      .update({ status: 'submitted', submitted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'draft')
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async reject(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('supplier_quotes')
      .update({ status: 'rejected' })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}
