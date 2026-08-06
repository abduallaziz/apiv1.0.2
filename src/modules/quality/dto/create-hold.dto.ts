import { IsUUID, IsOptional, IsNumber, Min, IsString } from 'class-validator';

export class CreateHoldDto {
  @IsUUID()
  warehouse_id: string;

  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  // Nullable/omitted = hold applies to the item/variant broadly, not a
  // specific counted quantity.
  @IsNumber()
  @Min(0.0001)
  @IsOptional()
  quantity_held?: number;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsUUID()
  @IsOptional()
  quality_inspection_id?: string;
}
