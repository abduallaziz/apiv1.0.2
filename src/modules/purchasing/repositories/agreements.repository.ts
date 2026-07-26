import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { PaginationDto } from '../../../shared/dto/pagination.dto';

@Injectable()
export class AgreementsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(
    tenantId: string,
    status?: string,
    pagination: PaginationDto = new PaginationDto(),
  ) {
    let query = this.supabase
      .from('agreements')
      .select(
        '*, suppliers(name), items:agreement_items(*, items(name, sku))',
        { count: 'exact' },
      )
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
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
      .from('agreements')
      .select('*, suppliers(name), items:agreement_items(*, items(name, sku))')
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
    const { data: agreement, error } = await this.supabase
      .from('agreements')
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
      .from('agreement_items')
      .insert(
        items.map((i) => ({
          ...i,
          tenant_id: tenantId,
          agreement_id: agreement.id,
        })),
      );
    if (itemsError) throw itemsError;

    return this.findById(agreement.id, tenantId);
  }

  async update(id: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('agreements')
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
      .from('agreements')
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
      .from('agreements')
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
      .from('agreements')
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

  async close(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('agreements')
      .update({ status: 'closed' })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'approved')
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async cancel(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('agreements')
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
      .from('agreements')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'draft');
    if (error) throw error;
  }
}
