import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { ScopedRepository } from '../tenant/scoped.repository';
import { TenantContext } from '../tenant/tenant-context';
import { CreateLoyaltyTierDto } from './dto/create-loyalty-tier.dto';
import { UpdateLoyaltyTierDto } from './dto/update-loyalty-tier.dto';

@Injectable()
export class LoyaltyTiersRepository extends ScopedRepository {
  constructor(@Inject(SUPABASE_CLIENT) supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenant: TenantContext) {
    const { data, error } = await this.scopedQuery('loyalty_tiers', tenant)
      .select('*')
      .order('min_lifetime_points', { ascending: true });
    if (error) throw error;
    return data;
  }

  async findById(tenant: TenantContext, id: string) {
    const { data, error } = await this.scopedQuery('loyalty_tiers', tenant)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  /** Highest tier whose threshold the given lifetime points total qualifies for, or null if none match (or no tiers configured). */
  async findMatchingTier(tenantId: string, lifetimePoints: number) {
    const { data, error } = await this.supabase
      .from('loyalty_tiers')
      .select('*')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .lte('min_lifetime_points', lifetimePoints)
      .order('min_lifetime_points', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(tenant: TenantContext, dto: CreateLoyaltyTierDto) {
    const { data, error } = await this.supabase
      .from('loyalty_tiers')
      .insert({ ...dto, tenant_id: tenant.tenantId })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new BadRequestException('A tier with this name already exists');
      }
      throw error;
    }
    return data;
  }

  async update(tenant: TenantContext, id: string, dto: UpdateLoyaltyTierDto) {
    const { data, error } = await this.supabase
      .from('loyalty_tiers')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId)
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new BadRequestException('A tier with this name already exists');
      }
      throw error;
    }
    return data;
  }

  async softDelete(tenant: TenantContext, id: string) {
    const { error } = await this.supabase
      .from('loyalty_tiers')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId);
    if (error) throw error;
  }
}
