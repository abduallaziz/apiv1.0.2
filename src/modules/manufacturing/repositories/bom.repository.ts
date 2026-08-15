import { ConflictException, Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { TenantContext } from '../../../core/tenant/tenant.context';
import { PaginationDto } from '../../../shared/dto/pagination.dto';
import { isUniqueViolation } from '../../../shared/supabase/postgrest-error.util';

// uq_bom_active_per_item (migration 112) — only one active BOM per
// (tenant, item, variant) at a time.
function toHttpError(error: unknown): unknown {
  if (isUniqueViolation(error)) {
    return new ConflictException(
      'An active BOM already exists for this item — deactivate it first',
    );
  }
  return error;
}

@Injectable()
export class BomRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  private ctx(tenantId: string): TenantContext {
    return { tenantId } as TenantContext;
  }

  async findAll(
    tenantId: string,
    pagination: PaginationDto = new PaginationDto(),
    filters: { item_id?: string; is_active?: boolean } = {},
  ): Promise<{ data: unknown[]; total: number }> {
    const [from, to] = pagination.range;
    let q = this.supabase
      .from('bill_of_materials')
      .select('*', { count: 'exact' })
      .is('deleted_at', null)
      .eq('tenant_id', tenantId);

    if (filters.item_id) q = q.eq('item_id', filters.item_id);
    if (filters.is_active !== undefined)
      q = q.eq('is_active', filters.is_active);

    const { data, error, count } = await q
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.scopedQuery(
      'bill_of_materials',
      this.ctx(tenantId),
    )
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findLines(bomId: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('bom_lines')
      .select('*')
      .eq('bom_id', bomId)
      .eq('tenant_id', tenantId)
      .order('created_at');
    if (error) throw error;
    return data ?? [];
  }

  // Only active BOMs collide on uq_bom_active_per_item — deactivating is
  // never a conflict, so no error translation needed here.
  async deactivateOthersForItem(
    tenantId: string,
    itemId: string,
    variantId: string | null,
    excludeBomId?: string,
  ) {
    let q = this.supabase
      .from('bill_of_materials')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('item_id', itemId)
      .eq('is_active', true)
      .is('deleted_at', null);
    q = variantId ? q.eq('variant_id', variantId) : q.is('variant_id', null);
    if (excludeBomId) q = q.neq('id', excludeBomId);
    const { error } = await q;
    if (error) throw error;
  }

  async create(
    tenantId: string,
    header: Record<string, unknown>,
    lines: Record<string, unknown>[],
  ) {
    const { data: bom, error } = await this.supabase
      .from('bill_of_materials')
      .insert({ ...header, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw toHttpError(error);

    const { error: linesError } = await this.supabase
      .from('bom_lines')
      .insert(
        lines.map((l) => ({ ...l, tenant_id: tenantId, bom_id: bom.id })),
      );
    if (linesError) throw linesError;

    return bom;
  }

  async update(id: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('bill_of_materials')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async setActive(id: string, tenantId: string, isActive: boolean) {
    const { data, error } = await this.supabase
      .from('bill_of_materials')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw toHttpError(error);
    return data;
  }

  async replaceLines(
    bomId: string,
    tenantId: string,
    lines: Record<string, unknown>[],
  ) {
    const { error: deleteError } = await this.supabase
      .from('bom_lines')
      .delete()
      .eq('bom_id', bomId)
      .eq('tenant_id', tenantId);
    if (deleteError) throw deleteError;

    const { error: insertError } = await this.supabase
      .from('bom_lines')
      .insert(lines.map((l) => ({ ...l, tenant_id: tenantId, bom_id: bomId })));
    if (insertError) throw insertError;

    return this.findLines(bomId, tenantId);
  }
}
