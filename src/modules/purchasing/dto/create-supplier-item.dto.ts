import { IsUUID, IsOptional, IsNumber, Min, IsBoolean } from 'class-validator';

export class CreateSupplierItemDto {
  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  lead_time_days?: number;

  @IsNumber()
  @Min(0.0001)
  @IsOptional()
  minimum_order_quantity?: number;

  @IsBoolean()
  @IsOptional()
  is_preferred?: boolean;
}
