import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { PoolClient } from 'pg';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { LoyaltyTiersRepository } from './loyalty-tiers.repository';
import { TenantContext } from '../tenant/tenant-context';
import { TenantSessionService } from '../tenant/tenant-session.service';

export interface LoyaltySettings {
  points_per_currency: number;
  redemption_value: number;
  enabled: boolean;
}

@Injectable()
export class LoyaltyService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly tiersRepo: LoyaltyTiersRepository,
    private readonly tenantSession: TenantSessionService,
  ) {}

  async getSettings(tenantId: string): Promise<LoyaltySettings> {
    const { data, error } = await this.supabase
      .from('tenants')
      .select('loyalty_points_per_currency, loyalty_redemption_value, loyalty_enabled')
      .eq('id', tenantId)
      .maybeSingle();

    if (error || !data) return { points_per_currency: 1, redemption_value: 0.01, enabled: true };
    return {
      points_per_currency: data.loyalty_points_per_currency ?? 1,
      redemption_value: data.loyalty_redemption_value ?? 0.01,
      enabled: data.loyalty_enabled ?? true,
    };
  }

  calculatePointsEarned(amountSpent: number, settings: LoyaltySettings): number {
    return Math.floor(amountSpent * settings.points_per_currency);
  }

  calculateRedemptionValue(points: number, settings: LoyaltySettings): number {
    return parseFloat((points * settings.redemption_value).toFixed(2));
  }

  /**
   * Confirms the customer belongs to this tenant before any points are read/adjusted.
   * fn_adjust_loyalty_points itself takes no tenant_id (see migration 041/069) — without this
   * check a cashier could pass any other tenant's customer_id in the invoice DTO and read or
   * mutate that customer's loyalty balance.
   */
  private async assertCustomerInTenant(tenantId: string, customerId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('customers')
      .select('id')
      .eq('id', customerId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new BadRequestException('Customer not found');
  }

  /** Awards points to a customer (positive delta). Silently no-ops on failure — never blocks a sale. */
  async awardPoints(tenantId: string, customerId: string, points: number): Promise<void> {
    if (points <= 0) return;
    await this.assertCustomerInTenant(tenantId, customerId);
    await this.supabase.rpc('fn_adjust_loyalty_points', {
      p_customer_id: customerId,
      p_delta: points,
    });
  }

  /** Redeems points from a customer (throws if the balance is insufficient). */
  async redeemPoints(tenantId: string, customerId: string, points: number): Promise<void> {
    if (points <= 0) return;
    await this.assertCustomerInTenant(tenantId, customerId);
    const { data, error } = await this.supabase.rpc('fn_adjust_loyalty_points', {
      p_customer_id: customerId,
      p_delta: -points,
    });
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      throw new BadRequestException('Insufficient loyalty points balance');
    }
  }

  /** Bonus multiplier from the customer's current tier (by lifetime points earned, not spendable balance). Defaults to 1 if no tiers are configured or none match yet. */
  async getTierMultiplier(tenantId: string, customerId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('customers')
      .select('lifetime_points_earned')
      .eq('id', customerId)
      .eq('tenant_id', tenantId)
      .single();
    if (error || !data) return 1;

    const tier = await this.tiersRepo.findMatchingTier(tenantId, data.lifetime_points_earned ?? 0);
    return tier?.points_multiplier ?? 1;
  }

  async getBalance(tenantId: string, customerId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('customers')
      .select('loyalty_points')
      .eq('id', customerId)
      .eq('tenant_id', tenantId)
      .single();
    if (error || !data) return 0;
    return data.loyalty_points ?? 0;
  }

  // ─── Pooled/RLS-enforced path (final named target of the hot-path migration
  // subtask — see TASKS.md "SAFETY & SCALE INITIATIVE") ──────────────────────
  //
  // This one differs from Invoices (§80) and Stock (§81) in a way worth being
  // explicit about: `fn_adjust_loyalty_points(p_customer_id, p_delta)` takes
  // no p_tenant_id parameter at all (see the `assertCustomerInTenant`
  // docstring above) — the *only* thing that has ever stopped a cashier from
  // passing another tenant's customer_id and mutating their balance is that
  // separate, non-atomic `assertCustomerInTenant` SELECT running first.
  // `fn_adjust_loyalty_points` is `LANGUAGE sql` with no `SECURITY DEFINER`,
  // so it runs as SECURITY INVOKER by default — meaning its internal
  // `UPDATE customers ...` *is* subject to RLS on `customers` for whatever
  // role executes it. Combined with migration 075's policy on `customers`,
  // routing this through `TenantSessionService` makes the tenant boundary
  // enforced by Postgres itself, not just by this application-level check —
  // the check stays, now inside the same transaction, for a correct "Customer
  // not found" error instead of a silent zero-row UPDATE.
  //
  // IMPORTANT CAVEAT, applies retroactively to §80/§81 too: this only holds
  // if the role authenticating `DATABASE_URL` does NOT have BYPASSRLS.
  // Supabase's own `postgres` role (the default shown in its dashboard
  // connection strings) typically does bypass RLS, same as `service_role` —
  // using it here would silently reproduce Warning 2 from STATUS.md §79
  // through the new pooled path instead of fixing it. A dedicated restricted
  // Postgres role (NOBYPASSRLS, explicit GRANTs on `customers` and EXECUTE on
  // `fn_adjust_loyalty_points`) must back `DATABASE_URL` before this — or any
  // of the pooled writes so far — actually enforces anything. Not something
  // this session can provision; flagging so it isn't assumed solved.
  private async assertCustomerInTenantPooled(
    client: PoolClient,
    tenantId: string,
    customerId: string,
  ): Promise<void> {
    const result = await client.query(
      'SELECT id FROM customers WHERE id = $1 AND tenant_id = $2',
      [customerId, tenantId],
    );
    if (result.rows.length === 0) throw new BadRequestException('Customer not found');
  }

  async getBalancePooled(tenantId: string, customerId: string): Promise<number> {
    const tenant = new TenantContext(tenantId);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const result = await client.query<{ loyalty_points: number | null }>(
        'SELECT loyalty_points FROM customers WHERE id = $1 AND tenant_id = $2',
        [customerId, tenantId],
      );
      return result.rows[0]?.loyalty_points ?? 0;
    });
  }

  async awardPointsPooled(tenantId: string, customerId: string, points: number): Promise<void> {
    if (points <= 0) return;
    const tenant = new TenantContext(tenantId);
    await this.tenantSession.runInTenantContext(tenant, async (client) => {
      await this.assertCustomerInTenantPooled(client, tenantId, customerId);
      await client.query('SELECT * FROM fn_adjust_loyalty_points($1, $2)', [customerId, points]);
    });
  }

  async redeemPointsPooled(tenantId: string, customerId: string, points: number): Promise<void> {
    if (points <= 0) return;
    const tenant = new TenantContext(tenantId);
    await this.tenantSession.runInTenantContext(tenant, async (client) => {
      await this.assertCustomerInTenantPooled(client, tenantId, customerId);
      const result = await client.query(
        'SELECT * FROM fn_adjust_loyalty_points($1, $2)',
        [customerId, -points],
      );
      if (result.rows.length === 0) {
        throw new BadRequestException('Insufficient loyalty points balance');
      }
    });
  }
}
