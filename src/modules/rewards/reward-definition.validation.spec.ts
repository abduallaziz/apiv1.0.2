import { BadRequestException } from '@nestjs/common';
import { validateRewardDefinition } from './reward-definition.validation';

describe('validateRewardDefinition', () => {
  const ok = {
    trigger_type: 'purchase_count',
    trigger_config: { count: 5 },
    reward_type: 'fixed_discount',
    reward_config: { amount: 10 },
  };

  it('accepts a valid definition', () => {
    expect(() => validateRewardDefinition(ok)).not.toThrow();
  });

  it('rejects negative / zero threshold', () => {
    expect(() =>
      validateRewardDefinition({ ...ok, trigger_config: { count: -5 } }),
    ).toThrow(BadRequestException);
    expect(() =>
      validateRewardDefinition({
        ...ok,
        trigger_type: 'spend_threshold',
        trigger_config: { threshold: 0 },
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects negative fixed discount', () => {
    expect(() =>
      validateRewardDefinition({ ...ok, reward_config: { amount: -10 } }),
    ).toThrow(BadRequestException);
  });

  it('rejects percentage above 100', () => {
    expect(() =>
      validateRewardDefinition({
        ...ok,
        reward_type: 'percentage_discount',
        reward_config: { percent: 150 },
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      validateRewardDefinition({
        ...ok,
        reward_type: 'percentage_discount',
        reward_config: { percent: 100 },
      }),
    ).not.toThrow();
  });

  it('requires an item / coupon / category reference', () => {
    expect(() =>
      validateRewardDefinition({
        ...ok,
        reward_type: 'free_item',
        reward_config: { item_ids: [] },
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      validateRewardDefinition({
        ...ok,
        reward_type: 'coupon_reference',
        reward_config: {},
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      validateRewardDefinition({
        ...ok,
        trigger_type: 'product_category',
        trigger_config: {},
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a negative min order amount', () => {
    expect(() =>
      validateRewardDefinition({
        ...ok,
        usage_conditions: { min_order_amount: -1 },
      }),
    ).toThrow(BadRequestException);
  });
});
