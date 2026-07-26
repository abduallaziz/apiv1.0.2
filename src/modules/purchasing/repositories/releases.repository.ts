import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { PaginationDto } from '../../../shared/dto/pagination.dto';

@Injectable()
export class ReleasesRepository extends ScopedRepository {
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
      .from('agreement_releases')
      .select(
        '*, items:agreement_release_items(*, agreement_items(item_id, items(name, sku)))',
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
      .from('agreement_releases')
      .select(
        '*, items:agreement_release_items(*, agreement_items(item_id, items(name, sku)))',
      )
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // Release-specific derived data -- not owned by AgreementsRepository
  // (which never queried per-item committed quantity, pricing, or
  // released totals). Agreement-level eligibility (status/overage_policy)
  // is read via the existing AgreementsRepository.findById() from the
  // Service, not duplicated here.

  async getAgreementItemCommitted(agreementItemId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('agreement_items')
      .select('id, item_id, committed_quantity, agreement_id')
      .eq('id', agreementItemId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async getApprovedReleasedQuantity(agreementItemId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('agreement_release_items')
      .select('released_quantity, agreement_releases!inner(status)')
      .eq('agreement_item_id', agreementItemId)
      .eq('tenant_id', tenantId)
      .eq('agreement_releases.status', 'approved');
    if (error) throw error;
    return (data ?? []).reduce(
      (sum, row: any) => sum + Number(row.released_quantity),
      0,
    );
  }

  async getEffectivePricing(agreementItemId: string, tenantId: string) {
    const { data: pricing, error } = await this.supabase
      .from('agreement_pricing')
      .select('*')
      .eq('agreement_item_id', agreementItemId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!pricing) return null;

    if (pricing.pricing_type !== 'tiered') {
      return { pricing, tiers: [] };
    }

    const { data: tiers, error: tiersError } = await this.supabase
      .from('agreement_pricing_tiers')
      .select('*')
      .eq('agreement_pricing_id', pricing.id)
      .eq('tenant_id', tenantId)
      .order('tier_order', { ascending: true });
    if (tiersError) throw tiersError;
    return { pricing, tiers: tiers ?? [] };
  }

  async getLatestApprovedAmendment(agreementId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('agreement_amendments')
      .select('id')
      .eq('agreement_id', agreementId)
      .eq('tenant_id', tenantId)
      .eq('status', 'approved')
      .order('approved_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data?.id ?? null;
  }

  // Delegates the atomic header+items insert to fn_create_agreement_release
  // (migration 138) -- avoids the orphan-header risk present in every
  // other create() in this module (documented, not fixed, as technical
  // debt).
  async create(
    tenantId: string,
    header: {
      agreement_id: string;
      release_number: string;
      notes: string | null;
      effective_amendment_id: string | null;
    },
    items: Record<string, unknown>[],
    createdBy: string,
  ) {
    const { data, error } = await this.supabase.rpc(
      'fn_create_agreement_release',
      {
        p_tenant_id: tenantId,
        p_agreement_id: header.agreement_id,
        p_release_number: header.release_number,
        p_notes: header.notes,
        p_effective_amendment_id: header.effective_amendment_id,
        p_created_by: createdBy,
        p_items: items,
      },
    );
    if (error) throw error;
    return this.findById(data.id, tenantId);
  }

  async update(id: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('agreement_releases')
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
      .from('agreement_releases')
      .update({ status: 'submitted' })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'draft')
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async approve(
    id: string,
    tenantId: string,
    approvedBy: string,
    resolvedAt: string,
  ) {
    const { data, error } = await this.supabase
      .from('agreement_releases')
      .update({
        status: 'approved',
        approved_by: approvedBy,
        approved_at: resolvedAt,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'submitted')
      .select()
      .single();
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
      .from('agreement_releases')
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

  // 'approved' is a terminal state (same decision as Amendments) --
  // cancel is only reachable from draft/submitted.
  async cancel(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('agreement_releases')
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
      .from('agreement_releases')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'draft');
    if (error) throw error;
  }
}
