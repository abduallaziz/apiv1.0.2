import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsIn,
  IsNumber,
  Min,
  Max,
} from 'class-validator';

export class CreateRuleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsUUID()
  @IsOptional()
  applies_to_item_id?: string;

  @IsUUID()
  @IsOptional()
  applies_to_category_id?: string;

  @IsUUID()
  @IsOptional()
  applies_to_supplier_id?: string;

  @IsUUID()
  @IsOptional()
  applies_to_warehouse_id?: string;

  @IsIn(['goods_receipt', 'production_output', 'stock_count'])
  @IsOptional()
  transaction_type?: 'goods_receipt' | 'production_output' | 'stock_count';

  @IsIn([
    'require_inspection',
    'create_hold',
    'require_approval',
    'apply_sampling',
  ])
  action:
    | 'require_inspection'
    | 'create_hold'
    | 'require_approval'
    | 'apply_sampling';

  @IsUUID()
  @IsOptional()
  template_id?: string;

  @IsNumber()
  @Min(0.01)
  @Max(100)
  @IsOptional()
  sample_size_percent?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  acceptance_defect_count?: number;
}
