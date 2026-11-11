import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export type RewardTriggerType =
  | 'purchase_count'
  | 'spend_threshold'
  | 'product_category'
  | 'birthday'
  | 'campaign'
  | 'loyalty_points';

export type RewardType =
  | 'free_item'
  | 'percentage_discount'
  | 'fixed_discount'
  | 'coupon_reference';

export class CreateRewardDefinitionDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEnum([
    'purchase_count',
    'spend_threshold',
    'product_category',
    'birthday',
    'campaign',
    'loyalty_points',
  ])
  trigger_type: RewardTriggerType;

  @IsObject()
  trigger_config: Record<string, unknown>;

  @IsEnum([
    'free_item',
    'percentage_discount',
    'fixed_discount',
    'coupon_reference',
  ])
  reward_type: RewardType;

  @IsObject()
  reward_config: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  usage_conditions?: Record<string, unknown>;

  @IsEnum(['all', 'specific'])
  branch_scope: 'all' | 'specific';

  @IsOptional()
  @IsUUID()
  @ValidateIf((o) => o.branch_scope === 'specific')
  branch_id?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  expiration_days?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
