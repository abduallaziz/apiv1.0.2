import {
  IsUUID,
  IsString,
  IsNotEmpty,
  IsIn,
  IsOptional,
} from 'class-validator';

export class CreateNonConformanceDto {
  // Required unless source='customer_complaint' (validated in the service —
  // a customer-complaint-sourced NCR has no inspection to link to).
  @IsUUID()
  @IsOptional()
  quality_inspection_id?: string;

  @IsUUID()
  item_id: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsIn(['minor', 'major', 'critical'])
  @IsOptional()
  severity?: 'minor' | 'major' | 'critical';

  @IsIn([
    'manufacturing_defect',
    'supplier_defect',
    'packaging_defect',
    'specification_failure',
    'customer_complaint',
    'other',
  ])
  @IsOptional()
  category?: string;

  @IsIn(['inspection', 'customer_complaint', 'manual'])
  @IsOptional()
  source?: 'inspection' | 'customer_complaint' | 'manual';

  @IsUUID()
  @IsOptional()
  customer_id?: string;

  @IsString()
  @IsOptional()
  customer_reference?: string;
}
