import { BadRequestException } from '@nestjs/common';

const MAX_AMOUNT = 1_000_000;

interface DefinitionShape {
  trigger_type?: string;
  trigger_config?: Record<string, unknown> | null;
  reward_type?: string;
  reward_config?: Record<string, unknown> | null;
  usage_conditions?: Record<string, unknown> | null;
}

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

function positive(v: unknown, field: string, max: number, integer = false) {
  if (!isNum(v) || v <= 0) {
    throw new BadRequestException(`${field} must be greater than 0`);
  }
  if (v > max) {
    throw new BadRequestException(`${field} must not be greater than ${max}`);
  }
  if (integer && !Number.isInteger(v)) {
    throw new BadRequestException(`${field} must be a whole number`);
  }
}

/**
 * Semantic validation of the free-form trigger_config / reward_config JSON.
 * Throws 400 so a negative discount / threshold or a percentage above 100 can
 * never be stored (a negative discount would raise the invoice total).
 */
export function validateRewardDefinition(def: DefinitionShape): void {
  const tc = def.trigger_config ?? {};
  const rc = def.reward_config ?? {};

  switch (def.trigger_type) {
    case 'purchase_count':
      positive(tc.count, 'count', 100_000, true);
      break;
    case 'spend_threshold':
      positive(tc.threshold, 'threshold', MAX_AMOUNT);
      break;
    case 'loyalty_points':
      positive(tc.points, 'points', 10_000_000, true);
      break;
    case 'product_category':
      if (typeof tc.category_id !== 'string' || !tc.category_id.trim()) {
        throw new BadRequestException('category_id is required');
      }
      break;
    default:
      break;
  }

  switch (def.reward_type) {
    case 'fixed_discount':
      positive(rc.amount, 'amount', MAX_AMOUNT);
      break;
    case 'percentage_discount':
      positive(rc.percent, 'percent', 100);
      break;
    case 'free_item': {
      const ids = Array.isArray(rc.item_ids) ? rc.item_ids : [];
      const single = typeof rc.item_id === 'string' && rc.item_id.trim();
      if (ids.length === 0 && !single) {
        throw new BadRequestException('At least one free item is required');
      }
      break;
    }
    case 'coupon_reference':
      if (typeof rc.coupon_id !== 'string' || !rc.coupon_id.trim()) {
        throw new BadRequestException('coupon_id is required');
      }
      break;
    default:
      break;
  }

  const min = def.usage_conditions?.min_order_amount;
  if (min !== undefined && min !== null) {
    if (!isNum(min) || min < 0 || min > MAX_AMOUNT) {
      throw new BadRequestException(
        'min_order_amount must be between 0 and 1000000',
      );
    }
  }
}
