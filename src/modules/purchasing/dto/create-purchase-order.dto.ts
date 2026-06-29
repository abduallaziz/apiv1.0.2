import {
  IsUUID,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsNumber,
  Min,
  IsArray,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PurchaseOrderLineDto {
  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsNumber()
  @Min(0.0001)
  quantity_ordered: number;

  @IsNumber()
  @Min(0)
  unit_cost: number;
}

export class CreatePurchaseOrderDto {
  @IsUUID()
  supplier_id: string;

  @IsUUID()
  warehouse_id: string;

  @IsString()
  @IsNotEmpty()
  order_number: string;

  @IsDateString()
  @IsOptional()
  order_date?: string;

  @IsDateString()
  @IsOptional()
  expected_date?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  items: PurchaseOrderLineDto[];
}
