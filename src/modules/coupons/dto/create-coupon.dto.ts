import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateCouponDto {
  @IsString()
  @MinLength(2)
  code: string;

  @IsEnum(['percentage', 'fixed'])
  discount_type: 'percentage' | 'fixed';

  @IsNumber()
  @Min(0.01)
  // A percentage coupon can't exceed 100 — checkout-time clamping to the subtotal already
  // prevents a negative total, but without this a coupon meant as "15% off" could be saved
  // as "150" by mistake and nothing would catch it.
  @ValidateIf((o) => o.discount_type === 'percentage')
  @Max(100)
  discount_value: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  max_discount_amount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  min_order_amount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  max_uses?: number;

  @IsOptional()
  @IsISO8601()
  valid_from?: string;

  @IsOptional()
  @IsISO8601()
  valid_to?: string;
}
