import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { ScopedRepository } from '../../core/tenant/scoped.repository';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';

@Injectable()
export class CouponsRepository extends ScopedRepository {
  constructor(@Inject(SUPABASE_CLIENT) supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenant: TenantContext) {
    const { data, error } = await this.scopedQuery('coupons', tenant)
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findById(tenant: TenantContext, id: string) {
    const { data, error } = await this.scopedQuery('coupons', tenant)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  /**
   * Exact lookup (case-insensitive via uppercasing, not SQL `ilike`) used both by CRUD
   * duplicate checks and checkout validation. Codes are always stored uppercase (see
   * CouponsService.create) — `ilike` was previously used here, but Postgres/PostgREST
   * treats `%`/`_` in the pattern as wildcards, so a raw user-supplied checkout code like
   * "%" would match *any* coupon in the tenant and pass validation. Uppercase + `eq` avoids
   * that entirely while keeping the same case-insensitive behavior for legitimate codes.
   */
  async findByCode(tenant: TenantContext, code: string) {
    const { data, error } = await this.scopedQuery('coupons', tenant)
      .select('*')
      .eq('code', code.toUpperCase())
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(tenant: TenantContext, dto: CreateCouponDto) {
    const { data, error } = await this.supabase
      .from('coupons')
      .insert({ ...dto, tenant_id: tenant.tenantId })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new BadRequestException('A coupon with this code already exists');
      }
      throw error;
    }
    return data;
  }

  async update(tenant: TenantContext, id: string, dto: UpdateCouponDto) {
    const { data, error } = await this.supabase
      .from('coupons')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId)
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new BadRequestException('A coupon with this code already exists');
      }
      throw error;
    }
    return data;
  }

  async softDelete(tenant: TenantContext, id: string) {
    const { error } = await this.supabase
      .from('coupons')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId);
    if (error) throw error;
  }

  /** Atomic guarded increment via fn_redeem_coupon — returns null if the coupon is exhausted/inactive by now. */
  async redeem(couponId: string): Promise<number | null> {
    const { data, error } = await this.supabase.rpc('fn_redeem_coupon', {
      p_coupon_id: couponId,
    });
    if (error) throw error;
    if (!data || data.length === 0) return null;
    return data[0].used_count;
  }
}
