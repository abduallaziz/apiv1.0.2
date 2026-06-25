import { IsString, IsOptional, MinLength, MaxLength, IsEnum, IsBoolean } from 'class-validator';
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
}