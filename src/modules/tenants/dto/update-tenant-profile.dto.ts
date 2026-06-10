import { IsString, IsOptional, MinLength, MaxLength, IsEnum } from 'class-validator';
import { BusinessType } from '../../../shared/types/enums';

// H-027 FIX: removed local BusinessType enum — import from shared enums
// shared enums uses 'services' (plural); local was 'service' (singular) — mismatch fixed

export class UpdateTenantProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEnum(BusinessType)
  business_type?: BusinessType;
}