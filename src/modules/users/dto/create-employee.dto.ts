import { IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

// Employee Core creation — deliberately has NO email/password/role requirement.
// This is what the "create employee without a login account" architecture rule
// maps to: a System User (email+password+role) is a separate, optional concern
// created later via POST /users if/when this person needs dashboard access.
export class CreateEmployeeDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  employee_number?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  identity_number?: string;

  @IsString()
  @IsOptional()
  department?: string;

  @IsString()
  @IsOptional()
  job_title?: string;

  @IsString()
  @IsOptional()
  manager_name?: string;

  @IsIn(['full_time', 'part_time'])
  @IsOptional()
  employment_type?: 'full_time' | 'part_time';

  @IsDateString()
  @IsOptional()
  join_date?: string;

  @IsString()
  @IsOptional()
  branch_id?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  gps_radius_meters?: number;

  // If true, an attendance token is generated right after the employee is
  // created — mirrors the existing "Generate Link" action, just folded into
  // the wizard's final step instead of a separate later click.
  @IsBoolean()
  @IsOptional()
  enable_attendance?: boolean;
}
