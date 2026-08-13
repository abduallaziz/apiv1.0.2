import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class InvoiceItemDto {
  @IsUUID()
  item_id: string;

  @IsString()
  item_name: string;

  @IsOptional()
  @IsUUID()
  variant_id?: string;

  @IsOptional()
  @IsString()
  variant_name?: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  unit_price: number;

  // Optional — only present when the line is a serialized unit (item_serials).
  // Absent entirely for normal, non-serialized sales, which continue
  // completely unchanged (Migration 13.14 Phase 3).
  @IsOptional()
  @IsUUID()
  serial_id?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  warranty_months?: number;
}

export class DiscountDto {
  @IsEnum(['percentage', 'fixed'])
  type: 'percentage' | 'fixed';

  @IsNumber()
  @Min(0)
  value: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  max_allowed?: number;
}

export class CreateInvoiceDto {
  @IsUUID()
  branch_id: string;

  // Client-generated per checkout attempt (same value reused across a
  // double-click/retry of the same attempt, a new value for a genuinely
  // new sale) — the sole mechanism M187 relies on for idempotency. See
  // migration 187_sale_idempotency.sql.
  @IsUUID()
  sale_attempt_id: string;

  @IsOptional()
  @IsUUID()
  shift_id?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items: InvoiceItemDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => DiscountDto)
  discount?: DiscountDto;

  @IsOptional()
  @IsUUID()
  customer_id?: string;

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
    'tab',
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
    | 'apple_pay'
    | 'tab';

  @IsOptional()
  @IsNumber()
  @Min(0)
  cash_tendered?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cash_amount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  card_amount?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tax_rate?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  redeem_points?: number;

  @IsOptional()
  @IsString()
  coupon_code?: string;
}
