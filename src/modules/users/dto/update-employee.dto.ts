import { IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

// Employee Core editing — deliberately excludes email/password/role/login
// status. Those belong to the System User side (PATCH /users/:id) even when
// both live on the same row today; this DTO is the enforcement point that
// keeps "who can change what" separated regardless of storage layout.
export class UpdateEmployeeDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  avatar_url?: string | null;

  @IsString()
  @IsOptional()
  employee_number?: string | null;

  @IsString()
  @IsOptional()
  phone?: string | null;

  @IsEmail()
  @IsOptional()
  email?: string | null;

  @IsString()
  @IsOptional()
  identity_number?: string | null;

  @IsString()
  @IsOptional()
  department?: string | null;

  @IsString()
  @IsOptional()
  job_title?: string | null;

  @IsString()
  @IsOptional()
  manager_name?: string | null;

  @IsIn(['full_time', 'part_time'])
  @IsOptional()
  employment_type?: 'full_time' | 'part_time' | null;

  @IsDateString()
  @IsOptional()
  join_date?: string | null;

  @IsString()
  @IsOptional()
  city?: string | null;

  @IsString()
  @IsOptional()
  address?: string | null;

  @IsInt()
  @Min(1)
  @IsOptional()
  gps_radius_meters?: number | null;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @IsBoolean()
  @IsOptional()
  attendance_enabled?: boolean;

  // Payroll policy — moved here from the old EmployeeSettingsModal (which used
  // to edit these via the System User endpoint). Payroll is employment data,
  // not authentication data, so it belongs on the Employee domain DTO.
  @IsNumber()
  @Min(0)
  @IsOptional()
  base_salary?: number | null;

  @IsInt()
  @Min(0)
  @IsOptional()
  grace_period_minutes?: number;

  @IsIn(['fixed', 'per_minute', 'percentage_of_daily_rate'])
  @IsOptional()
  late_deduction_mode?: 'fixed' | 'per_minute' | 'percentage_of_daily_rate' | null;

  @IsNumber()
  @Min(0)
  @IsOptional()
  late_deduction_value?: number | null;
}
