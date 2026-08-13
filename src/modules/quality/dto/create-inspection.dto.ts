import { IsUUID, IsIn, IsOptional, IsString, IsNumber, IsBoolean } from 'class-validator';

export class CreateInspectionDto {
  @IsIn(['goods_receipt', 'stock_count', 'production_order'])
  reference_type: 'goods_receipt' | 'stock_count' | 'production_order';

  @IsUUID()
  reference_id: string;

  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsUUID()
  @IsOptional()
  template_id?: string;

  @IsUUID()
  @IsOptional()
  plan_id?: string;

  @IsUUID()
  @IsOptional()
  warehouse_id?: string;

  @IsUUID()
  @IsOptional()
  batch_id?: string;

  @IsNumber()
  @IsOptional()
  quantity_inspected?: number;

  @IsBoolean()
  @IsOptional()
  is_sampling?: boolean;

  @IsNumber()
  @IsOptional()
  sample_size?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
