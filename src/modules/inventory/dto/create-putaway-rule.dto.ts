import { IsString, IsNotEmpty, IsOptional, IsUUID, IsIn, IsNumber, IsBoolean } from 'class-validator';

export class CreatePutawayRuleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsUUID()
  @IsOptional()
  warehouse_id?: string;

  @IsUUID()
  @IsOptional()
  applies_to_item_id?: string;

  @IsUUID()
  @IsOptional()
  applies_to_category_id?: string;

  @IsIn(['receiving', 'storage', 'picking', 'packing', 'quality_hold', 'damaged', 'shipping'])
  @IsOptional()
  target_location_purpose?: string;

  @IsUUID()
  target_location_id: string;

  @IsNumber()
  @IsOptional()
  priority?: number;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}
