import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';

@Injectable()
export class BranchPublicationsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  get client(): SupabaseClient {
    return this.supabase;
  }

  async findTargetId(
    tenantId: string,
    entityType: string,
    sourceId: string,
    targetBranchId: string,
  ): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('branch_publications')
      .select('target_id')
      .eq('tenant_id', tenantId)
      .eq('entity_type', entityType)
      .eq('source_id', sourceId)
      .eq('target_branch_id', targetBranchId)
      .maybeSingle<{ target_id: string }>();
    if (error) throw error;
    return data?.target_id ?? null;
  }

  async record(row: {
    tenant_id: string;
    entity_type: string;
    source_id: string;
    source_branch_id: string;
    target_branch_id: string;
    target_id: string;
    created_by: string | null;
  }): Promise<void> {
    const { error } = await this.supabase
      .from('branch_publications')
      .upsert(
        { ...row, updated_at: new Date().toISOString() },
        { onConflict: 'tenant_id,entity_type,source_id,target_branch_id' },
      );
    if (error) throw error;
  }

  /** Active, non-deleted branches of the tenant. */
  async activeBranches(
    tenantId: string,
  ): Promise<{ id: string; name: string; is_main: boolean }[]> {
    const { data, error } = await this.supabase
      .from('branches')
      .select('id, name, is_main')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .is('deleted_at', null);
    if (error) throw error;
    return (data ?? []) as { id: string; name: string; is_main: boolean }[];
  }
}
