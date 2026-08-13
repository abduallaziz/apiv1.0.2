import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsBoolean,
} from 'class-validator';

export class CreateSupplierDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  contact_name?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  tax_number?: string;

  @IsString()
  @IsOptional()
  payment_terms?: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  // Migration 13.16C (#16, Subcontracting) — a supplier can be a normal
  // goods supplier, a subcontractor, or both; this is just a flag, not a
  // separate record type. Omitted/false preserves exact prior behavior
  // for every existing supplier.
  @IsBoolean()
  @IsOptional()
  is_subcontractor?: boolean;
}
