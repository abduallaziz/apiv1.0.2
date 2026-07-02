import { IsEmail, IsObject, IsOptional, IsString, MaxLength, IsBoolean } from 'class-validator';

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  full_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsObject()
  custom_fields?: Record<string, string | number | boolean | null>;

  // Server-computed from custom_fields via contact_role; not part of the public request body.
  plate_number?: string;
  visit_date?: string;
  odometer?: number;
}