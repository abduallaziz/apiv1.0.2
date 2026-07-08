import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { ScopedRepository } from '../../core/tenant/scoped.repository';
import { TenantContext } from '../../core/tenant/tenant-context';
import { UpdateGiftCardDto } from './dto/update-gift-card.dto';

@Injectable()
export class GiftCardsRepository extends ScopedRepository {
  constructor(@Inject(SUPABASE_CLIENT) supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenant: TenantContext) {
    const { data, error } = await this.scopedQuery('gift_cards', tenant)
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findById(tenant: TenantContext, id: string) {
    const { data, error } = await this.scopedQuery('gift_cards', tenant)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findByCode(tenant: TenantContext, code: string) {
    const { data, error } = await this.scopedQuery('gift_cards', tenant)
      .select('*')
      .ilike('code', code)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(tenant: TenantContext, data: { code: string; initial_balance: number; customer_id?: string; expires_at?: string }) {
    const { data: row, error } = await this.supabase
      .from('gift_cards')
      .insert({
        tenant_id: tenant.tenantId,
        code: data.code,
        initial_balance: data.initial_balance,
        current_balance: data.initial_balance,
        customer_id: data.customer_id ?? null,
        expires_at: data.expires_at ?? null,
      })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new BadRequestException('A gift card with this code already exists');
      }
      throw error;
    }
    return row;
  }

  async update(tenant: TenantContext, id: string, dto: UpdateGiftCardDto) {
    const { data, error } = await this.supabase
      .from('gift_cards')
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
      .from('gift_cards')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId);
    if (error) throw error;
  }

  /** Atomic guarded decrement via fn_redeem_gift_card — returns null if the card is inactive/exhausted/deleted by now. */
  async redeem(giftCardId: string, amount: number): Promise<number | null> {
    const { data, error } = await this.supabase.rpc('fn_redeem_gift_card', {
      p_gift_card_id: giftCardId,
      p_amount: amount,
    });
    if (error) throw error;
    if (!data || data.length === 0) return null;
    return data[0].current_balance;
  }
}
