import { IsUUID, IsOptional, IsNumber, Min, IsString, IsNotEmpty, IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export class ShipmentLineDto {
  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsUUID()
  @IsOptional()
  location_id?: string;

  @IsNumber()
  @Min(0.0001)
  quantity_requested: number;
}

export class CreateShipmentDto {
  @IsUUID()
  warehouse_id: string;

  @IsString()
  @IsNotEmpty()
  reference_type: string;

  @IsUUID()
  reference_id: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShipmentLineDto)
  items: ShipmentLineDto[];
}
