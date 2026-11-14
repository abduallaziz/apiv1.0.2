import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CheckoutDineInDto {
  @IsEnum([
    'cash',
    'card',
    'split',
    'wallet',
    'mada',
    'visa',
    'mastercard',
    'stc_pay',
    'apple_pay',
  ])
  payment_method:
    | 'cash'
    | 'card'
    | 'split'
    | 'wallet'
    | 'mada'
    | 'visa'
    | 'mastercard'
    | 'stc_pay'
    | 'apple_pay';

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000000)
  cash_tendered?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000000)
  cash_amount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000000)
  card_amount?: number;

  @IsOptional()
  @IsUUID()
  customer_id?: string;
}
