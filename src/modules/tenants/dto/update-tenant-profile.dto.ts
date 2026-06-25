import { IsString, IsOptional, MinLength, MaxLength, IsEnum, IsBoolean, IsNumber, Min, Max } from 'class-validator';
import { BusinessType } from '../../../shared/types/enums';

export class UpdateTenantProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEnum(BusinessType)
  business_type?: BusinessType;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency_symbol?: string;

  @IsOptional()
  @IsBoolean()
  customer_capture_enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  name_field_enabled?: boolean;

  // Stored as a fraction (0–1), e.g. 0.15 for 15%. The frontend sends value/100.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  tax_rate?: number;
}