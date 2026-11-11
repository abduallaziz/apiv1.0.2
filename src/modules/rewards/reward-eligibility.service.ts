import { Injectable, Logger } from '@nestjs/common';
import { RewardDefinitionsRepository } from './reward-definitions.repository';
import { RewardInstancesRepository } from './reward-instances.repository';
import { TenantContext } from '../../core/tenant/tenant-context';

export interface OrderCompletedEvent {
  customerId: string;
  branchId: string | null;
  orderId: string;
  orderTotal: number;
  itemIds: string[];
}

/**
 * Event-driven reward unlocking — never scans a customer's whole reward
 * collection. On a completed order it fetches only the tenant's active
 * definitions for the trigger types that actually have evaluation logic
 * (purchase_count, spend_threshold, product_category, loyalty_points —
 * birthday/campaign remain configurable via CRUD per the approved schema
 * but have no automatic event to evaluate against and are intentionally
 * not evaluated here) and evaluates each through its atomic, idempotent
 * DB function. Independent of Loyalty mutation entirely — this class only
 * ever reads lifetime_points_earned (passed in by the caller, already
 * computed by LoyaltyService), never writes loyalty_ledger/loyalty_points.
 */
const ORDER_EVALUATED_TRIGGER_TYPES = [
  'purchase_count',
  'spend_threshold',
  'product_category',
];

@Injectable()
export class RewardEligibilityService {
  private readonly logger = new Logger(RewardEligibilityService.name);

  constructor(
    private readonly definitionsRepo: RewardDefinitionsRepository,
    private readonly instancesRepo: RewardInstancesRepository,
  ) {}

  /**
   * Best-effort, post-commit, called after order creation (mirrors the
   * coupon-redeem / stock-deduction pattern in invoices.service.ts) — a
   * reward-evaluation failure must never affect an already-completed sale.
   * Safe to call more than once for the same order: every underlying
   * function is idempotent (purchase_count/spend_threshold per
   * (reward_definition_id, order_id); loyalty_points per the
   * customer's monotonic lifetime_points_earned).
   */
  async onOrderCompleted(
    tenant: TenantContext,
    event: OrderCompletedEvent,
  ): Promise<void> {
    if (!tenant.tenantId) return;
    const { customerId, branchId, orderId, orderTotal, itemIds } = event;

    let definitions;
    try {
      definitions = await this.definitionsRepo.findActiveByTriggerTypes(
        tenant,
        ORDER_EVALUATED_TRIGGER_TYPES,
      );
    } catch (err) {
      this.logger.warn(
        `Reward definitions lookup failed for order ${orderId}: ${(err as Error)?.message ?? err}`,
      );
      return;
    }

    if (!definitions || definitions.length === 0) return;

    // Only queried when at least one active product_category definition
    // exists — never on the far more common purchase_count/spend_threshold/
    // loyalty_points-only path.
    let orderCategoryIds: Set<string> | null = null;
    const needsCategoryLookup = definitions.some(
      (d) => d.trigger_type === 'product_category',
    );
    if (needsCategoryLookup) {
      try {
        orderCategoryIds = await this.instancesRepo.getItemCategoryIds(
          tenant,
          itemIds,
        );
      } catch (err) {
        this.logger.warn(
          `Order category lookup failed for order ${orderId}: ${(err as Error)?.message ?? err}`,
        );
        orderCategoryIds = new Set();
      }
    }

    for (const definition of definitions) {
      try {
        switch (definition.trigger_type) {
          case 'purchase_count':
            await this.instancesRepo.processPurchaseEvent(
              tenant.tenantId,
              customerId,
              definition.id,
              orderId,
              branchId,
            );
            break;

          case 'spend_threshold':
            await this.instancesRepo.processSpendThresholdEvent(
              tenant.tenantId,
              customerId,
              definition.id,
              orderId,
              orderTotal,
              branchId,
            );
            break;

          case 'product_category': {
            const categoryId = (
              definition.trigger_config as Record<string, unknown> | null
            )?.category_id as string | undefined;
            if (
              categoryId &&
              orderCategoryIds &&
              orderCategoryIds.has(categoryId)
            ) {
              await this.instancesRepo.processPurchaseEvent(
                tenant.tenantId,
                customerId,
                definition.id,
                orderId,
                branchId,
              );
            }
            break;
          }
        }
      } catch (err) {
        this.logger.warn(
          `Reward eligibility evaluation failed for order ${orderId}, definition ${definition.id}: ${(err as Error)?.message ?? err}`,
        );
      }
    }
  }

  /**
   * Separate entry point, deliberately not folded into onOrderCompleted:
   * loyalty_points evaluation needs the customer's POST-award
   * lifetime_points_earned, but Loyalty award itself runs fire-and-forget
   * in invoices.service.ts (a deliberate non-blocking design predating
   * Rewards) — chaining this onto that same promise keeps the same
   * non-blocking characteristics rather than forcing the response to wait
   * on the award just to feed this trigger. Best-effort, same as
   * onOrderCompleted.
   */
  async onLoyaltyPointsAwarded(
    tenant: TenantContext,
    customerId: string,
    branchId: string | null,
  ): Promise<void> {
    if (!tenant.tenantId) return;
    let definitions;
    try {
      definitions = await this.definitionsRepo.findActiveByTriggerType(
        tenant,
        'loyalty_points',
      );
    } catch (err) {
      this.logger.warn(
        `Reward (loyalty_points) definitions lookup failed for customer ${customerId}: ${(err as Error)?.message ?? err}`,
      );
      return;
    }

    for (const definition of definitions ?? []) {
      try {
        await this.instancesRepo.processLoyaltyPointsEvent(
          tenant.tenantId,
          customerId,
          definition.id,
          branchId,
        );
      } catch (err) {
        this.logger.warn(
          `Reward (loyalty_points) eligibility evaluation failed for customer ${customerId}, definition ${definition.id}: ${(err as Error)?.message ?? err}`,
        );
      }
    }
  }
}
