import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SubcontractOrderLineDto {
  @IsUUID()
  material_item_id: string;

  @IsUUID()
  @IsOptional()
  material_variant_id?: string;

  @IsNumber()
  @Min(0.0001)
  quantity_sent: number;

  @IsUUID()
  output_item_id: string;

  @IsUUID()
  @IsOptional()
  output_variant_id?: string;

  @IsNumber()
  @Min(0.0001)
  output_quantity: number;
}

export class CreateSubcontractOrderDto {
  @IsUUID()
  supplier_id: string;

  @IsUUID()
  warehouse_id: string;

  @IsUUID()
  @IsOptional()
  production_order_id?: string;

  @IsString()
  @IsNotEmpty()
  order_number: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubcontractOrderLineDto)
  lines: SubcontractOrderLineDto[];
}
