import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

import { CustomerCaptureDto } from '../../customers/dto/customer-lookup.dto';

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

  // Set when this line was rung up by scanning a packaging-level barcode
  // (Box/Carton/Pallet) rather than the item's own unit barcode. `quantity`
  // is then the count of that packaging level (e.g. "1 Carton"), and
  // InvoicesService resolves it to the storage-unit-equivalent quantity
  // in place, before price resolution, PosEngine totals, order_items, or
  // stock deduction ever see it — so every downstream consumer of
  // `quantity` is automatically correct with zero further changes.
  @IsOptional()
  @IsUUID()
  packaging_level_id?: string;

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

  // D01-M7 — Price Override justification for this line, when
  // unit_price differs from the server-resolved official price and the
  // effective Policy's reason_policy requires one. Ignored entirely for a
  // Normal Sale line (requested === official).
  @IsOptional()
  @IsString()
  reason?: string;

  // G4 — the worker who performed this line. The commission rate/amount
  // are snapshotted server-side from users.commission_rate at sale time;
  // anything the client sends for them is ignored.
  @IsOptional()
  @IsUUID()
  worker_id?: string;
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

  // T12 — phone/plate typed at the POS; resolved (found or created) by the
  // server when the sale is confirmed. A phone and a plate that belong to
  // two different customers is a 409 (customer_capture_conflict).
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerCaptureDto)
  customer_capture?: CustomerCaptureDto;

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

  // Customer Domain Batch 3 Phase 11 (Owner-approved) — explicit,
  // cashier/customer-confirmed selection. Never auto-redeemed; suggestion
  // (GET /customers/:id/rewards) is a separate, non-mutating read.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  redeem_reward_instance_ids?: string[];

  // For free-item rewards configured as "one of several": which product the
  // customer picked at the till for each such reward instance.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FreeItemChoiceDto)
  free_item_choices?: FreeItemChoiceDto[];

  // For free items that have variants (size/colour): the variant the customer
  // takes, one entry per (reward instance, item).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FreeItemVariantChoiceDto)
  free_item_variants?: FreeItemVariantChoiceDto[];
}

export class FreeItemVariantChoiceDto {
  @IsUUID('4')
  reward_instance_id: string;

  @IsUUID('4')
  item_id: string;

  @IsUUID('4')
  variant_id: string;
}

export class FreeItemChoiceDto {
  @IsUUID('4')
  reward_instance_id: string;

  @IsUUID('4')
  item_id: string;
}
