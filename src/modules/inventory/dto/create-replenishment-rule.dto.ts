import { IsString, IsNotEmpty, IsOptional, IsUUID, IsNumber, Min, IsBoolean } from 'class-validator';

export class CreateReplenishmentRuleDto {
  @IsUUID()
  warehouse_id: string;

  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsUUID()
  destination_location_id: string;

  @IsUUID()
  source_location_id: string;

  @IsNumber()
  @Min(0)
  min_quantity: number;

  @IsNumber()
  @Min(0.0001)
  max_quantity: number;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}
