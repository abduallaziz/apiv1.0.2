import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { ScopedRepository } from '../../core/tenant/scoped.repository';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CreateNotePresetDto } from './dto/create-note-preset.dto';
import { UpdateNotePresetDto } from './dto/update-note-preset.dto';

@Injectable()
export class NotePresetsRepository extends ScopedRepository {
  constructor(@Inject(SUPABASE_CLIENT) supabase: SupabaseClient) {
    super(supabase);
  }

  /** Full list for the admin management page — every preset, active or not. */
  async findAll(tenant: TenantContext) {
    const { data, error } = await this.scopedQuery('note_presets', tenant)
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data;
  }

  /** Active-only, ordered — what the POS "choose from list" tab actually shows. */
  async findActive(tenant: TenantContext) {
    const { data, error } = await this.scopedQuery('note_presets', tenant)
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data;
  }

  async findById(tenant: TenantContext, id: string) {
    const { data, error } = await this.scopedQuery('note_presets', tenant)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(
    tenant: TenantContext,
    dto: CreateNotePresetDto & { sort_order: number },
  ) {
    const { data, error } = await this.supabase
      .from('note_presets')
      .insert({ ...dto, tenant_id: tenant.tenantId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(tenant: TenantContext, id: string, dto: UpdateNotePresetDto) {
    const { data, error } = await this.supabase
      .from('note_presets')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async softDelete(tenant: TenantContext, id: string) {
    const { error } = await this.supabase
      .from('note_presets')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId);
    if (error) throw error;
  }

  /** Highest current sort_order for this tenant, so a new preset lands at the end of the list. */
  async maxSortOrder(tenant: TenantContext): Promise<number> {
    const { data, error } = await this.scopedQuery('note_presets', tenant)
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data?.sort_order ?? -1;
  }

  async reorder(tenant: TenantContext, ids: string[]) {
    // Sequential, guarded by tenant_id on every row — matches every other write in
    // this repository. Not a single bulk statement because the Supabase JS client
    // has no "update N rows to N different values" primitive.
    await Promise.all(
      ids.map((id, index) =>
        this.supabase
          .from('note_presets')
          .update({ sort_order: index, updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('tenant_id', tenant.tenantId),
      ),
    );
    return this.findAll(tenant);
  }
}
