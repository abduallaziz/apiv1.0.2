import { IsIn, IsOptional, IsString, IsArray, ValidateNested, IsBoolean, IsNumber, IsUUID, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class InspectionResultDto {
  @IsUUID()
  @IsOptional()
  template_check_id?: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsNumber()
  @IsOptional()
  measured_value?: number;

  @IsBoolean()
  passed: boolean;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CompleteInspectionDto {
  @IsIn(['passed', 'failed', 'conditional'])
  status: 'passed' | 'failed' | 'conditional';

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => InspectionResultDto)
  results?: InspectionResultDto[];

  @IsNumber()
  @IsOptional()
  defect_count?: number;

  // When status='failed' (or 'conditional', at the caller's discretion), a
  // hold can be created automatically in the same request — avoids a
  // separate round-trip and matches "Failed Inspection -> Quality Hold"
  // from the approved design. Omit to skip auto-hold creation.
  @IsBoolean()
  @IsOptional()
  auto_hold?: boolean;
}
