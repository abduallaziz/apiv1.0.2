import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
  Matches,
  MinLength,
} from 'class-validator';

// Sane upper bound for any money amount / usage count on a coupon.
export const MAX_COUPON_AMOUNT = 1_000_000;

export class CreateCouponDto {
  // Letters, digits, dash and underscore only (no spaces / Arabic). Stored uppercase.
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'code may contain only letters, digits, - and _',
  })
  code: string;

  @IsEnum(['percentage', 'fixed'])
  discount_type: 'percentage' | 'fixed';

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.01)
  // The percentage <= 100 rule is cross-field (depends on discount_type) and is
  // enforced in CouponsService for both create and update.
  @Max(MAX_COUPON_AMOUNT)
  discount_value: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(MAX_COUPON_AMOUNT)
  max_discount_amount?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_COUPON_AMOUNT)
  min_order_amount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_COUPON_AMOUNT)
  max_uses?: number;

  @IsOptional()
  @IsISO8601()
  valid_from?: string;

  @IsOptional()
  @IsISO8601()
  valid_to?: string;
}
