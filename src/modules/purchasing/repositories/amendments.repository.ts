import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { PaginationDto } from '../../../shared/dto/pagination.dto';

@Injectable()
export class AmendmentsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(
    tenantId: string,
    agreementId?: string,
    status?: string,
    pagination: PaginationDto = new PaginationDto(),
  ) {
    let query = this.supabase
      .from('agreement_amendments')
      .select(
        '*, items:agreement_amendment_items(*, agreement_items(item_id, items(name, sku)), new_item:items!new_item_id(name, sku))',
        { count: 'exact' },
      )
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (agreementId) query = query.eq('agreement_id', agreementId);
    if (status) query = query.eq('status', status);

    const [from, to] = pagination.range;
    const { data, error, count } = await query.range(from, to);
    if (error) throw error;
    return {
      data: data ?? [],
      total: count ?? 0,
      page: pagination.page,
      perPage: pagination.perPage,
    };
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('agreement_amendments')
      .select(
        '*, items:agreement_amendment_items(*, agreement_items(item_id, items(name, sku)), new_item:items!new_item_id(name, sku))',
      )
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async getAgreementStatus(agreementId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('agreements')
      .select('status')
      .eq('id', agreementId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data?.status as string | undefined;
  }

  async getItemHasVariants(itemId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('items')
      .select('has_variants')
      .eq('id', itemId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data?.has_variants as boolean | undefined;
  }

  async create(
    tenantId: string,
    payload: Record<string, unknown>,
    items: Record<string, unknown>[],
    createdBy: string,
  ) {
    const { data: amendment, error } = await this.supabase
      .from('agreement_amendments')
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
      .from('agreement_amendment_items')
      .insert(
        items.map((i) => ({
          ...i,
          tenant_id: tenantId,
          amendment_id: amendment.id,
        })),
      );
    if (itemsError) throw itemsError;

    return this.findById(amendment.id, tenantId);
  }

  async update(id: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('agreement_amendments')
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
      .from('agreement_amendments')
      .update({ status: 'submitted' })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'draft')
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // Delegates the entire atomic transition (agreement_items mutation +
  // status flip + approval_history insert) to fn_approve_agreement_amendment
  // (migration 137) -- this repository method does NOT record
  // approval_history itself, since the RPC already does that in the same
  // transaction. Callers must not double-record.
  async approve(
    id: string,
    tenantId: string,
    approvedBy: string,
    resolvedAt: string,
  ) {
    const { data, error } = await this.supabase.rpc(
      'fn_approve_agreement_amendment',
      {
        p_tenant_id: tenantId,
        p_amendment_id: id,
        p_approved_by: approvedBy,
        p_resolved_at: resolvedAt,
      },
    );
    if (error) throw error;
    return data;
  }

  async reject(
    id: string,
    tenantId: string,
    rejectedBy: string,
    resolvedAt: string,
    note: string,
  ) {
    const { data, error } = await this.supabase
      .from('agreement_amendments')
      .update({
        status: 'rejected',
        approved_by: rejectedBy,
        approved_at: resolvedAt,
        notes: note,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // 'approved' is a terminal state (per explicit decision) -- cancel is
  // only reachable from draft/submitted.
  async cancel(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('agreement_amendments')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .in('status', ['draft', 'submitted'])
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async softDelete(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('agreement_amendments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'draft');
    if (error) throw error;
  }
}
