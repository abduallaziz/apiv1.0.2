import { IsUUID, IsOptional, IsNumber, Min, IsString, IsIn } from 'class-validator';

export class CreateHoldDto {
  @IsUUID()
  warehouse_id: string;

  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsUUID()
  @IsOptional()
  location_id?: string;

  @IsUUID()
  @IsOptional()
  batch_id?: string;

  @IsUUID()
  @IsOptional()
  serial_id?: string;

  // Nullable/omitted = hold the item/variant's full currently-available
  // quantity at hold time (resolved inside fn_create_quality_hold).
  @IsNumber()
  @Min(0.0001)
  @IsOptional()
  quantity_held?: number;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsIn(['goods_receipt', 'stock_count', 'production_order', 'manual'])
  @IsOptional()
  source_document_type?: 'goods_receipt' | 'stock_count' | 'production_order' | 'manual';

  @IsUUID()
  @IsOptional()
  source_document_id?: string;

  @IsUUID()
  @IsOptional()
  quality_inspection_id?: string;
}
