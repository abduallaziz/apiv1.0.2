import { IsUUID, IsIn, IsOptional, IsString } from 'class-validator';

export class CreateInspectionDto {
  @IsIn(['goods_receipt', 'stock_count'])
  reference_type: 'goods_receipt' | 'stock_count';

  @IsUUID()
  reference_id: string;

  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
