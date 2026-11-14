import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_MONEY_VALUE } from './create-item.dto';

// ملاحظة: stock_quantity أصبح حقلاً قديماً (legacy) منذ إدخال وحدة المخزون
// (stock_levels/stock_movements). لا يجوز ضبطه عبر هذا الـ DTO؛ استخدم
// Goods Receipt أو Stock Adjustment في وحدة Inventory لتسجيل أي كمية ابتدائية.
export class CreateVariantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-MAX_MONEY_VALUE)
  @Max(MAX_MONEY_VALUE)
  @IsOptional()
  price_adjustment?: number;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  sku?: string;
}
