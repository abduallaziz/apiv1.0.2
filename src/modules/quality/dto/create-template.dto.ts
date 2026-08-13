import { IsString, IsNotEmpty, IsOptional, IsArray, ValidateNested, IsIn, IsNumber, IsBoolean, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export class TemplateCheckDto {
  @IsNumber()
  @IsOptional()
  sequence?: number;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsIn(['pass_fail', 'measurement'])
  @IsOptional()
  check_type?: 'pass_fail' | 'measurement';

  @IsNumber()
  @IsOptional()
  expected_value?: number;

  @IsNumber()
  @IsOptional()
  tolerance_min?: number;

  @IsNumber()
  @IsOptional()
  tolerance_max?: number;

  @IsBoolean()
  @IsOptional()
  is_required?: boolean;
}

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TemplateCheckDto)
  checks: TemplateCheckDto[];
}
