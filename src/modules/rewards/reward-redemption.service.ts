import { BadRequestException, Injectable } from '@nestjs/common';
import { RewardInstancesRepository } from './reward-instances.repository';
import { DiscountEngine } from '../../engines/discount-engine/discount.engine';
import { CouponsService } from '../coupons/coupons.service';
import { TenantContext } from '../../core/tenant/tenant-context';

export interface FreeItemGrant {
  reward_instance_id: string;
  item_id: string;
}

export interface RewardPricingPreview {
  discountAmount: number;
  freeItemGrants: FreeItemGrant[];
  instanceIds: string[];
  /** single-use instances (redeemed whole via fn_redeem_reward_instances) */
  singleUseIds?: string[];
  /** fixed-amount rewards: gross (VAT-inclusive) amount to consume from each balance */
  fixedConsumptions?: Array<{ instanceId: string; amount: number }>;
}

/** Basis for fixed-amount rewards: net amount left after other discounts, and 1 + VAT rate (1 when prices already include VAT). */
export interface FixedRewardBase {
  netBase: number;
  taxFactor: number;
}

/**
 * Reward Type effects supported per the approved architecture: free_item,
 * percentage_discount, fixed_discount, coupon_reference. Preserves existing
 * invoice pricing/tax semantics — this only ever produces a discount_amount
 * fed into the same subtotal->discount->tax->total pipeline coupons and
 * loyalty already use (see invoices.service.ts), never a parallel one.
 *
 * free_item is deliberately NOT auto-inserted as an order line here — doing
 * so would require picking a price/variant/quantity and mutating PosEngine's
 * item pipeline, which is a POS/frontend concern outside this backend-only
 * batch's scope (see STOP RULE — Frontend Scope). Instead the grant is
 * returned to the caller (freeItemGrants) so the cashier can add the actual
 * line manually; this is the documented backend contract for that gap.
 */
@Injectable()
export class RewardRedemptionService {
  constructor(
    private readonly instancesRepo: RewardInstancesRepository,
    private readonly discountEngine: DiscountEngine,
    private readonly couponsService: CouponsService,
  ) {}

  /**
   * Validates the selected instances against checkout-time conditions and
   * computes their combined pricing effect — mirrors CouponsService.validate
   * (throw on any failure, since the customer/cashier explicitly opted to
   * redeem these). Does NOT mutate any instance's status — that only
   * happens in redeemSelected, atomically, right before order creation.
   */
  async previewSelection(
    tenant: TenantContext,
    customerId: string,
    branchId: string,
    instanceIds: string[],
    subtotal: number,
    fixedBase?: FixedRewardBase,
  ): Promise<RewardPricingPreview> {
    const uniqueIds = [...new Set(instanceIds)];
    if (uniqueIds.length !== instanceIds.length) {
      throw new BadRequestException(
        'Duplicate reward instance selected more than once',
      );
    }

    const instances = await this.instancesRepo.findByIds(tenant, uniqueIds);
    if (!instances || instances.length !== uniqueIds.length) {
      throw new BadRequestException(
        'One or more selected reward instances were not found',
      );
    }

    let discountAmount = 0;
    const freeItemGrants: FreeItemGrant[] = [];
    const singleUseIds: string[] = [];
    const fixedPending: Array<{ instanceId: string; remaining: number }> = [];

    for (const instance of instances) {
      if (instance.customer_id !== customerId) {
        throw new BadRequestException(
          `Reward instance ${instance.id as string} does not belong to this customer`,
        );
      }
      if (instance.status !== 'unlocked') {
        throw new BadRequestException(
          `Reward instance ${instance.id as string} is not available to redeem`,
        );
      }
      if (instance.expires_at && new Date(instance.expires_at) <= new Date()) {
        throw new BadRequestException(
          `Reward instance ${instance.id as string} has expired`,
        );
      }

      const definition = instance.reward_definitions as {
        id: string;
        branch_scope: 'all' | 'specific';
        branch_id: string | null;
        reward_type: string;
        reward_config: Record<string, unknown>;
        usage_conditions: Record<string, unknown> | null;
      };

      if (
        definition.branch_scope === 'specific' &&
        definition.branch_id !== branchId
      ) {
        throw new BadRequestException(
          `Reward instance ${instance.id as string} is not valid at this branch`,
        );
      }

      const minOrderAmount = definition.usage_conditions?.min_order_amount as
        | number
        | undefined;
      if (minOrderAmount && subtotal < minOrderAmount) {
        throw new BadRequestException(
          `Reward instance ${instance.id as string} requires a minimum order of ${minOrderAmount}`,
        );
      }

      switch (definition.reward_type) {
        case 'percentage_discount': {
          const percent = Number(definition.reward_config.percent ?? 0);
          discountAmount += this.discountEngine.applyPercentageDiscount(
            subtotal,
            percent,
          );
          singleUseIds.push(instance.id as string);
          break;
        }
        case 'fixed_discount': {
          const amount = Number(definition.reward_config.amount ?? 0);
          if (fixedBase) {
            // Balance-carrying reward: consumed against the payable amount below.
            const remaining =
              instance.remaining_amount !== null &&
              instance.remaining_amount !== undefined
                ? Number(instance.remaining_amount)
                : amount;
            fixedPending.push({ instanceId: instance.id as string, remaining });
          } else {
            discountAmount += this.discountEngine.applyFixedDiscount(
              subtotal,
              amount,
            );
            singleUseIds.push(instance.id as string);
          }
          break;
        }
        case 'coupon_reference': {
          const couponId = definition.reward_config.coupon_id as
            | string
            | undefined;
          if (!couponId) {
            throw new BadRequestException(
              `Reward instance ${instance.id as string} has no coupon configured`,
            );
          }
          const coupon = await this.couponsService.findOneOrThrow(
            tenant,
            couponId,
          );
          discountAmount += this.couponsService.calculateDiscount(
            coupon,
            subtotal,
          );
          singleUseIds.push(instance.id as string);
          break;
        }
        case 'free_item': {
          const itemId = definition.reward_config.item_id as string | undefined;
          if (!itemId) {
            throw new BadRequestException(
              `Reward instance ${instance.id as string} has no item configured`,
            );
          }
          freeItemGrants.push({
            reward_instance_id: instance.id as string,
            item_id: itemId,
          });
          singleUseIds.push(instance.id as string);
          break;
        }
        default:
          throw new BadRequestException(
            `Unsupported reward type: ${definition.reward_type}`,
          );
      }
    }

    // Fixed-amount rewards act as a VAT-inclusive balance: they consume up to the
    // gross amount still payable (after the other discounts), and the net
    // discount is that gross divided by (1 + VAT). 20 SAR on a 5.75 sale (5.00 +
    // 0.75 VAT) consumes 5.75, leaves 14.25, and the sale total is 0.
    const fixedConsumptions: Array<{ instanceId: string; amount: number }> = [];
    if (fixedBase && fixedPending.length) {
      let grossLeft = parseFloat(
        (
          Math.max(fixedBase.netBase - discountAmount, 0) * fixedBase.taxFactor
        ).toFixed(2),
      );
      for (const p of fixedPending) {
        const consumed = parseFloat(Math.min(p.remaining, grossLeft).toFixed(2));
        if (consumed <= 0) continue;
        discountAmount += parseFloat((consumed / fixedBase.taxFactor).toFixed(2));
        grossLeft = parseFloat((grossLeft - consumed).toFixed(2));
        fixedConsumptions.push({ instanceId: p.instanceId, amount: consumed });
      }
    }

    discountAmount = this.discountEngine.checkMaxDiscount(
      discountAmount,
      subtotal,
    );

    return {
      discountAmount,
      freeItemGrants,
      instanceIds: uniqueIds,
      singleUseIds,
      fixedConsumptions,
    };
  }

  /** Atomic state transition — see fn_redeem_reward_instances. Called right before order creation, same ordering rationale as Loyalty redemption. */
  redeemSelected(
    tenantId: string,
    customerId: string,
    branchId: string,
    instanceIds: string[],
  ) {
    return this.instancesRepo.redeemInstances(
      tenantId,
      customerId,
      branchId,
      instanceIds,
    );
  }

  /** Consumes the previewed fixed-amount balances; returns the redemption ids (for undo / order linkage). */
  async consumeFixed(
    tenantId: string,
    customerId: string,
    branchId: string,
    consumptions: Array<{ instanceId: string; amount: number }>,
    saleAttemptId?: string,
  ): Promise<string[]> {
    const ids: string[] = [];
    try {
      for (const c of consumptions) {
        const r = await this.instancesRepo.consumeBalance(
          tenantId,
          customerId,
          branchId,
          c.instanceId,
          c.amount,
          saleAttemptId,
        );
        ids.push(r.redemption_id);
      }
    } catch (e) {
      await this.restoreConsumptions(tenantId, ids).catch(() => undefined);
      throw e;
    }
    return ids;
  }

  async restoreConsumptions(tenantId: string, redemptionIds: string[]) {
    for (const id of redemptionIds) {
      await this.instancesRepo.restoreBalance(tenantId, id);
    }
  }

  attachConsumptions(redemptionIds: string[], orderId: string) {
    if (!redemptionIds.length) return Promise.resolve();
    return this.instancesRepo.attachConsumptionOrder(redemptionIds, orderId);
  }

  /** Undo of redeemSelected when the sale itself failed (see releaseRedeemed). */
  releaseSelected(tenantId: string, customerId: string, instanceIds: string[]) {
    return this.instancesRepo.releaseRedeemed(tenantId, customerId, instanceIds);
  }

  /** Best-effort post-creation linkage — never allowed to affect the sale. */
  async attachOrder(instanceIds: string[], orderId: string): Promise<void> {
    if (instanceIds.length === 0) return;
    await this.instancesRepo.attachRedemptionOrder(instanceIds, orderId);
  }
}
