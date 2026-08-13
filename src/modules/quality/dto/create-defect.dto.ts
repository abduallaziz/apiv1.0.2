import {
  IsString,
  IsNotEmpty,
  IsIn,
  IsOptional,
  IsNumber,
  Min,
} from 'class-validator';

export class CreateDefectDto {
  @IsString()
  @IsNotEmpty()
  defect_code: string;

  @IsIn([
    'manufacturing_defect',
    'supplier_defect',
    'packaging_defect',
    'specification_failure',
  ])
  category: string;

  @IsIn(['minor', 'major', 'critical'])
  @IsOptional()
  severity?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  quantity_affected?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  cost_impact?: number;
}
