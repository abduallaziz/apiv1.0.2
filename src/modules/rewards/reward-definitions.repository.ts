import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { ScopedRepository } from '../../core/tenant/scoped.repository';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CreateRewardDefinitionDto } from './dto/create-reward-definition.dto';
import { UpdateRewardDefinitionDto } from './dto/update-reward-definition.dto';

@Injectable()
export class RewardDefinitionsRepository extends ScopedRepository {
  constructor(@Inject(SUPABASE_CLIENT) supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenant: TenantContext) {
    const { data, error } = await this.scopedQuery('reward_definitions', tenant)
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findById(tenant: TenantContext, id: string) {
    const { data, error } = await this.scopedQuery('reward_definitions', tenant)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  /** Active, non-deleted definitions of a given trigger type — used by event-driven eligibility evaluation (e.g. every completed order for purchase_count). */
  async findActiveByTriggerType(tenant: TenantContext, triggerType: string) {
    const { data, error } = await this.scopedQuery('reward_definitions', tenant)
      .select('*')
      .eq('trigger_type', triggerType)
      .eq('is_active', true);
    if (error) throw error;
    return data;
  }

  /** Same as findActiveByTriggerType but for several trigger types in one query — used when a single order-completed event needs to evaluate multiple trigger classes. */
  async findActiveByTriggerTypes(
    tenant: TenantContext,
    triggerTypes: string[],
  ) {
    const { data, error } = await this.scopedQuery('reward_definitions', tenant)
      .select('*')
      .in('trigger_type', triggerTypes)
      .eq('is_active', true);
    if (error) throw error;
    return data;
  }

  async create(tenant: TenantContext, dto: CreateRewardDefinitionDto) {
    const { data, error } = await this.supabase
      .from('reward_definitions')
      .insert({ ...dto, tenant_id: tenant.tenantId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateRewardDefinitionDto,
  ) {
    const { data, error } = await this.supabase
      .from('reward_definitions')
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
      .from('reward_definitions')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId);
    if (error) throw error;
  }
}
