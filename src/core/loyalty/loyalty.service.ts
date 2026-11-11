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

// Customer Domain Phase 6 (Owner-approved) — context threaded through to
// fn_adjust_loyalty_points on every mutation. All optional/nullable:
// branchId is null for a Central/global manual adjustment; orderId is null
// for manual adjustments AND for redemption specifically (redemption
// executes before the order row exists — see invoices.service.ts's own
// documented ordering); createdBy is the acting user, null for a
// system-initiated mutation if one is ever added.
export interface LoyaltyMutationContext {
  branchId?: string | null;
  orderId?: string | null;
  createdBy?: string | null;
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
      .select(
        'loyalty_points_per_currency, loyalty_redemption_value, loyalty_enabled',
      )
      .eq('id', tenantId)
      .maybeSingle();

    if (error || !data)
      return { points_per_currency: 1, redemption_value: 0.01, enabled: true };
    return {
      points_per_currency: data.loyalty_points_per_currency ?? 1,
      redemption_value: data.loyalty_redemption_value ?? 0.01,
      enabled: data.loyalty_enabled ?? true,
    };
  }

  calculatePointsEarned(
    amountSpent: number,
    settings: LoyaltySettings,
  ): number {
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
  private async assertCustomerInTenant(
    tenantId: string,
    customerId: string,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('customers')
      .select('id')
      .eq('id', customerId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new BadRequestException('Customer not found');
  }

  // Customer Domain Phase 7 (Owner-approved) — mirrors the exact fail-closed
  // convention established in Batch 1 Remediation 2
  // (CustomersRepository.getCustomerIdentityScope): a malformed/missing
  // read resolves to 'branch' (restrictive), never 'shared' (permissive).
  // A failure to determine Loyalty Scope must never widen what a
  // restricted actor can redeem.
  private async getLoyaltyScope(
    tenantId: string,
  ): Promise<'shared' | 'branch'> {
    const { data, error } = await this.supabase
      .from('tenants')
      .select('loyalty_scope')
      .eq('id', tenantId)
      .single();
    if (error) throw new Error(error.message);
    const value = data?.loyalty_scope as string | null | undefined;
    return value === 'shared' || value === 'branch' ? value : 'branch';
  }

  // customers.loyalty_points remains the tenant-wide pooled total in BOTH
  // scope modes (approved architecture, explicit) — this is never cached
  // per branch. Under BRANCH scope, the redeemable-at-this-branch amount is
  // computed live from the ledger, summing every event (earn/redeem/
  // adjustment) recorded against this exact (customer, branch) pair.
  private async getBranchBalance(
    tenantId: string,
    customerId: string,
    branchId: string,
  ): Promise<number> {
    const { data, error } = await this.supabase
      .from('loyalty_ledger')
      .select('delta')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('branch_id', branchId);
    if (error) throw new Error(error.message);
    return (data ?? []).reduce((sum, row) => sum + Number(row.delta), 0);
  }

  // Customer Domain Phase 7 (Owner-approved) — this is the ONLY place
  // Customer/Loyalty Scope logic lives; fn_adjust_loyalty_points itself
  // stays scope-unaware, purely recording context (per the approved
  // architecture: "Do NOT put Customer Scope logic inside the DB
  // function"). SHARED: the pooled customers.loyalty_points total is
  // authoritative — the DB function's own (loyalty_points + p_delta) >= 0
  // guard is already sufficient, nothing extra to check here. BRANCH: a
  // redemption at branch X may only draw down X's own ledger-computed
  // balance — redeeming at C can never consume points earned at B, even
  // though the pooled scalar in `customers` would technically allow it.
  private async assertSufficientBranchBalance(
    tenantId: string,
    customerId: string,
    points: number,
    context: LoyaltyMutationContext,
  ): Promise<void> {
    const scope = await this.getLoyaltyScope(tenantId);
    if (scope === 'shared') return;

    if (!context.branchId) {
      throw new BadRequestException(
        'Branch context is required to redeem loyalty points for this tenant',
      );
    }

    const branchBalance = await this.getBranchBalance(
      tenantId,
      customerId,
      context.branchId,
    );
    if (branchBalance < points) {
      throw new BadRequestException('Insufficient loyalty points balance');
    }
  }

  /** Awards points to a customer (positive delta). Silently no-ops on failure — never blocks a sale. */
  async awardPoints(
    tenantId: string,
    customerId: string,
    points: number,
    context: LoyaltyMutationContext = {},
  ): Promise<void> {
    if (points <= 0) return;
    await this.assertCustomerInTenant(tenantId, customerId);
    await this.supabase.rpc('fn_adjust_loyalty_points', {
      p_customer_id: customerId,
      p_delta: points,
      p_type: 'earn',
      p_branch_id: context.branchId ?? null,
      p_order_id: context.orderId ?? null,
      p_created_by: context.createdBy ?? null,
    });
  }

  /**
   * Compensation for a sale that failed AFTER points were redeemed: gives the
   * points back WITHOUT touching lifetime_points_earned (fn_adjust_loyalty_points
   * adds every positive delta to it, which would inflate tier statistics).
   * Optimistic: retries on a concurrent balance change. Ledger row type is
   * 'adjustment' (the ledger CHECK has no refund type yet).
   */
  async restoreRedeemedPoints(
    tenantId: string,
    customerId: string,
    points: number,
    context: LoyaltyMutationContext = {},
  ): Promise<boolean> {
    if (points <= 0) return false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: row, error } = await this.supabase
        .from('customers')
        .select('loyalty_points')
        .eq('id', customerId)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (error) throw error;
      if (!row) return false;
      const current = Number(row.loyalty_points);
      const { data: updated, error: updErr } = await this.supabase
        .from('customers')
        .update({ loyalty_points: current + points })
        .eq('id', customerId)
        .eq('tenant_id', tenantId)
        .eq('loyalty_points', current)
        .select('id');
      if (updErr) throw updErr;
      if (!updated?.length) continue; // balance changed under us: retry
      await this.supabase.from('loyalty_ledger').insert({
        tenant_id: tenantId,
        customer_id: customerId,
        branch_id: context.branchId ?? null,
        order_id: null,
        type: 'adjustment',
        delta: points,
        created_by: context.createdBy ?? null,
      });
      return true;
    }
    return false;
  }

  /** Redeems points from a customer (throws if the balance is insufficient). */
  async redeemPoints(
    tenantId: string,
    customerId: string,
    points: number,
    context: LoyaltyMutationContext = {},
  ): Promise<void> {
    if (points <= 0) return;
    await this.assertCustomerInTenant(tenantId, customerId);
    await this.assertSufficientBranchBalance(
      tenantId,
      customerId,
      points,
      context,
    );
    const { data, error } = await this.supabase.rpc(
      'fn_adjust_loyalty_points',
      {
        p_customer_id: customerId,
        p_delta: -points,
        p_type: 'redeem',
        p_branch_id: context.branchId ?? null,
        p_order_id: context.orderId ?? null,
        p_created_by: context.createdBy ?? null,
      },
    );
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      throw new BadRequestException('Insufficient loyalty points balance');
    }
  }

  /** Bonus multiplier from the customer's current tier (by lifetime points earned, not spendable balance). Defaults to 1 if no tiers are configured or none match yet. */
  async getTierMultiplier(
    tenantId: string,
    customerId: string,
  ): Promise<number> {
    const { data, error } = await this.supabase
      .from('customers')
      .select('lifetime_points_earned')
      .eq('id', customerId)
      .eq('tenant_id', tenantId)
      .single();
    if (error || !data) return 1;

    const tier = await this.tiersRepo.findMatchingTier(
      tenantId,
      data.lifetime_points_earned ?? 0,
    );
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
    if (result.rows.length === 0)
      throw new BadRequestException('Customer not found');
  }

  async getBalancePooled(
    tenantId: string,
    customerId: string,
  ): Promise<number> {
    const tenant = new TenantContext(tenantId);
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const result = await client.query<{ loyalty_points: number | null }>(
        'SELECT loyalty_points FROM customers WHERE id = $1 AND tenant_id = $2',
        [customerId, tenantId],
      );
      return result.rows[0]?.loyalty_points ?? 0;
    });
  }

  async awardPointsPooled(
    tenantId: string,
    customerId: string,
    points: number,
    context: LoyaltyMutationContext = {},
  ): Promise<void> {
    if (points <= 0) return;
    const tenant = new TenantContext(tenantId);
    await this.tenantSession.runInTenantContext(tenant, async (client) => {
      await this.assertCustomerInTenantPooled(client, tenantId, customerId);
      await client.query(
        'SELECT * FROM fn_adjust_loyalty_points($1, $2, $3, $4, $5, $6)',
        [
          customerId,
          points,
          'earn',
          context.branchId ?? null,
          context.orderId ?? null,
          context.createdBy ?? null,
        ],
      );
    });
  }

  async redeemPointsPooled(
    tenantId: string,
    customerId: string,
    points: number,
    context: LoyaltyMutationContext = {},
  ): Promise<void> {
    if (points <= 0) return;
    await this.assertSufficientBranchBalance(
      tenantId,
      customerId,
      points,
      context,
    );
    const tenant = new TenantContext(tenantId);
    await this.tenantSession.runInTenantContext(tenant, async (client) => {
      await this.assertCustomerInTenantPooled(client, tenantId, customerId);
      const result = await client.query(
        'SELECT * FROM fn_adjust_loyalty_points($1, $2, $3, $4, $5, $6)',
        [
          customerId,
          -points,
          'redeem',
          context.branchId ?? null,
          context.orderId ?? null,
          context.createdBy ?? null,
        ],
      );
      if (result.rows.length === 0) {
        throw new BadRequestException('Insufficient loyalty points balance');
      }
    });
  }

  /**
   * Manual/administrative adjustment (positive or negative delta), not tied
   * to an order. Customer Domain Phase 7 (Owner-approved) — respects branch
   * context exactly as any other mutation: a Central/global adjustment
   * passes context.branchId = null/undefined; a branch-scoped adjustment
   * carries its branch. No additional authorization is invented here beyond
   * what already exists — callers are responsible for confirming the actor
   * is allowed to make the adjustment before calling this.
   */
  async adjustPoints(
    tenantId: string,
    customerId: string,
    delta: number,
    context: LoyaltyMutationContext = {},
  ): Promise<{ loyalty_points: number; lifetime_points_earned: number }> {
    await this.assertCustomerInTenant(tenantId, customerId);
    const { data, error } = await this.supabase.rpc(
      'fn_adjust_loyalty_points',
      {
        p_customer_id: customerId,
        p_delta: delta,
        p_type: 'adjustment',
        p_branch_id: context.branchId ?? null,
        p_order_id: context.orderId ?? null,
        p_created_by: context.createdBy ?? null,
      },
    );
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      throw new BadRequestException(
        'Adjustment would result in a negative balance',
      );
    }
    return data[0] as {
      loyalty_points: number;
      lifetime_points_earned: number;
    };
  }
}
