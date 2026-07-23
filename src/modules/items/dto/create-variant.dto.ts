import { IsString, IsNotEmpty, IsNumber, IsOptional } from 'class-validator';

// ملاحظة: stock_quantity أصبح حقلاً قديماً (legacy) منذ إدخال وحدة المخزون
// (stock_levels/stock_movements). لا يجوز ضبطه عبر هذا الـ DTO؛ استخدم
// Goods Receipt أو Stock Adjustment في وحدة Inventory لتسجيل أي كمية ابتدائية.
export class CreateVariantDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @IsOptional()
  price_adjustment?: number;

  @IsString()
  @IsOptional()
  sku?: string;
}
