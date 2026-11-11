import {
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateCustomerDto {
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
  @IsObject()
  custom_fields?: Record<string, string | number | boolean | null>;

  // Customer Domain Phase 2 (Owner-approved) — control-panel creation may
  // explicitly select a creation/source branch; a restricted (branch-
  // scoped) actor's own branch always takes precedence over this value
  // (see CustomersService.create) — this field only has effect for a
  // Central actor. Informational only, never an authorization/visibility
  // scope (see migration 206).
  @IsOptional()
  @IsUUID()
  created_branch_id?: string;

  // Server-computed from custom_fields via contact_role; not part of the public request body.
  plate_number?: string;
  visit_date?: string;
  odometer?: number;
}
