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
          break;
        }
        case 'fixed_discount': {
          const amount = Number(definition.reward_config.amount ?? 0);
          discountAmount += this.discountEngine.applyFixedDiscount(
            subtotal,
            amount,
          );
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
          break;
        }
        default:
          throw new BadRequestException(
            `Unsupported reward type: ${definition.reward_type}`,
          );
      }
    }

    discountAmount = this.discountEngine.checkMaxDiscount(
      discountAmount,
      subtotal,
    );

    return { discountAmount, freeItemGrants, instanceIds: uniqueIds };
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

  /** Best-effort post-creation linkage — never allowed to affect the sale. */
  async attachOrder(instanceIds: string[], orderId: string): Promise<void> {
    if (instanceIds.length === 0) return;
    await this.instancesRepo.attachRedemptionOrder(instanceIds, orderId);
  }
}
