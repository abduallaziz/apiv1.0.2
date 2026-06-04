import { IsString, IsOptional, MinLength, MaxLength, IsEnum } from 'class-validator';

export enum BusinessType {
  RESTAURANT = 'restaurant',
  CAFE = 'cafe',
  RETAIL = 'retail',
  SERVICE = 'service',
  WORKSHOP = 'workshop',
  OTHER = 'other',
}

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