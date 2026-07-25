import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class AwardsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAllForRfq(rfqId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('awards')
      .select(
        '*, items:award_items(*, rfq_item:rfq_items(item_id, quantity_requested, items(name, sku)))',
      )
      .eq('rfq_id', rfqId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('awards')
      .select(
        '*, items:award_items(*, rfq_item:rfq_items(item_id, quantity_requested, items(name, sku)), quote_item:supplier_quote_items!source_supplier_quote_item_id(item_id, variant_id, items(name, sku), supplier_quotes(quote_group_id, quote_groups(supplier_id, suppliers(name)))))',
      )
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // Flat rows shaped for PO generation: each award_item joined through to
  // the supplier it actually belongs to (via its source quote), plus
  // item/variant identity. Used to group award lines by supplier when
  // generating purchase orders — one PO per supplier represented in the
  // award, so a future partial award spanning multiple suppliers already
  // produces the correct multiple POs with zero extra logic.
  async findItemsForPoGeneration(awardId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('award_items')
      .select(
        'id, awarded_quantity, awarded_unit_price, awarded_discount, awarded_currency, awarded_lead_time, awarded_tax_rate, source_supplier_quote_item_id, quote_item:supplier_quote_items!source_supplier_quote_item_id(item_id, variant_id, supplier_quote_id, supplier_quotes(quote_group_id, quote_groups(supplier_id)))',
      )
      .eq('award_id', awardId)
      .eq('tenant_id', tenantId);
    if (error) throw error;
    return data;
  }

  async hasConfirmedAward(rfqId: string, tenantId: string) {
    const { count, error } = await this.supabase
      .from('awards')
      .select('*', { count: 'exact', head: true })
      .eq('rfq_id', rfqId)
      .eq('tenant_id', tenantId)
      .eq('status', 'confirmed')
      .is('deleted_at', null);
    if (error) throw error;
    return (count ?? 0) > 0;
  }

  async create(
    tenantId: string,
    payload: Record<string, unknown>,
    items: Record<string, unknown>[],
    createdBy: string,
  ) {
    const { data: award, error } = await this.supabase
      .from('awards')
      .insert({
        ...payload,
        tenant_id: tenantId,
        created_by: createdBy,
        status: 'draft',
      })
      .select()
      .single();
    if (error) throw error;

    const { error: itemsError } = await this.supabase
      .from('award_items')
      .insert(
        items.map((i) => ({ ...i, tenant_id: tenantId, award_id: award.id })),
      );
    if (itemsError) throw itemsError;

    return this.findById(award.id, tenantId);
  }

  async confirm(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('awards')
      .update({ status: 'confirmed' })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'draft')
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async cancel(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('awards')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .in('status', ['draft', 'confirmed'])
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}
