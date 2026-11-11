import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { ScopedRepository } from '../../core/tenant/scoped.repository';
import { TenantContext } from '../../core/tenant/tenant-context';

export interface ProcessPurchaseRewardEventResult {
  out_instance_id: string;
  out_instance_ordinal: number;
}

@Injectable()
export class RewardInstancesRepository extends ScopedRepository {
  constructor(@Inject(SUPABASE_CLIENT) supabase: SupabaseClient) {
    super(supabase);
  }

  /** Atomic + idempotent (see fn_process_purchase_reward_event, migration 213/216) — safe to call once per completed order per candidate definition, including on retry. Serves both purchase_count and product_category (the caller pre-filters product_category by category match before calling this). */
  async processPurchaseEvent(
    tenantId: string,
    customerId: string,
    rewardDefinitionId: string,
    orderId: string,
    branchId: string | null,
  ): Promise<ProcessPurchaseRewardEventResult[]> {
    const { data, error } = await this.supabase.rpc(
      'fn_process_purchase_reward_event',
      {
        p_tenant_id: tenantId,
        p_customer_id: customerId,
        p_reward_definition_id: rewardDefinitionId,
        p_order_id: orderId,
        p_branch_id: branchId,
      },
    );
    if (error) throw error;
    return (data ?? []) as ProcessPurchaseRewardEventResult[];
  }

  /** Atomic + idempotent (see fn_process_spend_threshold_reward_event, migration 217) — accumulates order totals, can unlock multiple instances from a single large order. */
  async processSpendThresholdEvent(
    tenantId: string,
    customerId: string,
    rewardDefinitionId: string,
    orderId: string,
    orderTotal: number,
    branchId: string | null,
  ): Promise<ProcessPurchaseRewardEventResult[]> {
    const { data, error } = await this.supabase.rpc(
      'fn_process_spend_threshold_reward_event',
      {
        p_tenant_id: tenantId,
        p_customer_id: customerId,
        p_reward_definition_id: rewardDefinitionId,
        p_order_id: orderId,
        p_order_total: orderTotal,
        p_branch_id: branchId,
      },
    );
    if (error) throw error;
    return (data ?? []) as ProcessPurchaseRewardEventResult[];
  }

  /** Atomic + idempotent (see fn_process_loyalty_points_reward_event, migration 218) — evaluated against customers.lifetime_points_earned, not an order event. */
  async processLoyaltyPointsEvent(
    tenantId: string,
    customerId: string,
    rewardDefinitionId: string,
    branchId: string | null,
  ): Promise<ProcessPurchaseRewardEventResult[]> {
    const { data, error } = await this.supabase.rpc(
      'fn_process_loyalty_points_reward_event',
      {
        p_tenant_id: tenantId,
        p_customer_id: customerId,
        p_reward_definition_id: rewardDefinitionId,
        p_branch_id: branchId,
      },
    );
    if (error) throw error;
    return (data ?? []) as ProcessPurchaseRewardEventResult[];
  }

  /** Category lookup for the product_category trigger — scoped to only the item_ids on this exact order, never a catalog-wide scan. */
  async getItemCategoryIds(
    tenant: TenantContext,
    itemIds: string[],
  ): Promise<Set<string>> {
    if (itemIds.length === 0) return new Set();
    const { data, error } = await this.supabase
      .from('items')
      .select('category_id')
      .eq('tenant_id', tenant.tenantId)
      .in('id', itemIds)
      .not('category_id', 'is', null);
    if (error) throw error;
    return new Set((data ?? []).map((row) => row.category_id as string));
  }

  async findByCustomer(
    tenant: TenantContext,
    customerId: string,
    status?: string,
  ) {
    let query = this.supabase
      .from('customer_reward_instances')
      .select('*, reward_definitions(*)')
      .eq('tenant_id', tenant.tenantId)
      .eq('customer_id', customerId);
    if (status) query = query.eq('status', status);
    const { data, error } = await query.order('unlocked_at', {
      ascending: false,
    });
    if (error) throw error;
    return data;
  }

  /** Daily expiration sweep (Phase 10) — single guarded UPDATE via the indexed (status, expires_at) partial index, never a per-customer scan. */
  async expireDueInstances(): Promise<number> {
    const { data, error } = await this.supabase.rpc(
      'fn_expire_reward_instances',
    );
    if (error) throw error;
    return (data ?? []).length;
  }

  /** Fetches only the specific instances selected for redemption — never a full customer scan, per the approved architecture. */
  async findByIds(tenant: TenantContext, ids: string[]) {
    const { data, error } = await this.supabase
      .from('customer_reward_instances')
      .select('*, reward_definitions(*)')
      .eq('tenant_id', tenant.tenantId)
      .in('id', ids);
    if (error) throw error;
    return data;
  }

  /**
   * Atomic, all-or-nothing redemption of the given instances (see
   * fn_redeem_reward_instances, migration 215). Throws (surfacing the DB's
   * exact validation message) if any single instance fails ownership/
   * status/expiry/branch-scope checks — nothing is redeemed in that case.
   */
  async redeemInstances(
    tenantId: string,
    customerId: string,
    branchId: string,
    instanceIds: string[],
  ) {
    const { data, error } = await this.supabase.rpc(
      'fn_redeem_reward_instances',
      {
        p_tenant_id: tenantId,
        p_customer_id: customerId,
        p_branch_id: branchId,
        p_instance_ids: instanceIds,
      },
    );
    if (error) throw error;
    return data ?? [];
  }

  /**
   * Compensation for a sale that failed AFTER fn_redeem_reward_instances ran:
   * puts the instances back to 'unlocked'. Only touches instances still marked
   * redeemed with no order attached, so it can never undo a completed sale.
   */
  async releaseRedeemed(
    tenantId: string,
    customerId: string,
    instanceIds: string[],
  ): Promise<number> {
    const { data, error } = await this.supabase
      .from('customer_reward_instances')
      .update({
        status: 'unlocked',
        redeemed_at: null,
        redeemed_branch_id: null,
      })
      .in('id', instanceIds)
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('status', 'redeemed')
      .is('redeemed_order_id', null)
      .select('id');
    if (error) throw error;
    return data?.length ?? 0;
  }

  /** Best-effort post-creation enrichment — order_id isn't known at redemption time (same constraint as Loyalty). Never throws in a way that affects the sale. */
  async attachRedemptionOrder(
    instanceIds: string[],
    orderId: string,
  ): Promise<void> {
    const { error } = await this.supabase.rpc(
      'fn_attach_reward_redemption_order',
      { p_instance_ids: instanceIds, p_order_id: orderId },
    );
    if (error) throw error;
  }
}
