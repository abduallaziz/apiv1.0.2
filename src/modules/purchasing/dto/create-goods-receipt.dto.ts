import {
  IsUUID,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GoodsReceiptLineDto {
  @IsUUID()
  @IsOptional()
  purchase_order_item_id?: string;

  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsNumber()
  @Min(0.0001)
  quantity_received: number;

  @IsNumber()
  @Min(0)
  unit_cost: number;

  @IsString()
  @IsOptional()
  batch_number?: string;

  @IsString()
  @IsOptional()
  serial_number?: string;

  @IsDateString()
  @IsOptional()
  expiration_date?: string;

  @IsUUID()
  @IsOptional()
  location_id?: string;

  // Unit the human actually counted/entered this line in. When omitted,
  // quantity_received/unit_cost are already in the item's storage unit
  // (today's behavior, unchanged). When given, the service converts to
  // storage-unit terms before persisting.
  @IsUUID()
  @IsOptional()
  unit_id?: string;
}

export class CreateGoodsReceiptDto {
  @IsUUID()
  @IsOptional()
  purchase_order_id?: string;

  @IsUUID()
  warehouse_id: string;

  @IsString()
  @IsNotEmpty()
  receipt_number: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptLineDto)
  items: GoodsReceiptLineDto[];
}
