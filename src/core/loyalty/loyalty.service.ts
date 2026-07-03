import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

export interface LoyaltySettings {
  points_per_currency: number;
  redemption_value: number;
}

@Injectable()
export class LoyaltyService {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

  async getSettings(tenantId: string): Promise<LoyaltySettings> {
    const { data, error } = await this.supabase
      .from('tenants')
      .select('loyalty_points_per_currency, loyalty_redemption_value')
      .eq('id', tenantId)
      .single();

    if (error || !data) return { points_per_currency: 1, redemption_value: 0.01 };
    return {
      points_per_currency: data.loyalty_points_per_currency ?? 1,
      redemption_value: data.loyalty_redemption_value ?? 0.01,
    };
  }

  calculatePointsEarned(amountSpent: number, settings: LoyaltySettings): number {
    return Math.floor(amountSpent * settings.points_per_currency);
  }

  calculateRedemptionValue(points: number, settings: LoyaltySettings): number {
    return parseFloat((points * settings.redemption_value).toFixed(2));
  }

  /** Awards points to a customer (positive delta). Silently no-ops on failure — never blocks a sale. */
  async awardPoints(customerId: string, points: number): Promise<void> {
    if (points <= 0) return;
    await this.supabase.rpc('fn_adjust_loyalty_points', {
      p_customer_id: customerId,
      p_delta: points,
    });
  }

  /** Redeems points from a customer (throws if the balance is insufficient). */
  async redeemPoints(customerId: string, points: number): Promise<void> {
    if (points <= 0) return;
    const { data, error } = await this.supabase.rpc('fn_adjust_loyalty_points', {
      p_customer_id: customerId,
      p_delta: -points,
    });
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      throw new BadRequestException('Insufficient loyalty points balance');
    }
  }

  async getBalance(customerId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('customers')
      .select('loyalty_points')
      .eq('id', customerId)
      .single();
    if (error || !data) return 0;
    return data.loyalty_points ?? 0;
  }
}
