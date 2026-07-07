import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, Max, MinLength } from 'class-validator';
import { UserRole } from '../../../shared/types/enums';

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @MinLength(8)
  @IsOptional()
  password?: string;

  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @IsString()
  @IsOptional()
  branch_id?: string;

  @IsString()
  @IsOptional()
  department?: string | null;

  @IsString()
  @IsOptional()
  job_title?: string | null;

  @IsString()
  @IsOptional()
  avatar_url?: string | null;

  // Stored as a fraction (0-1), e.g. 0.05 for 5%. null clears it (no commission).
  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  commission_rate?: number | null;

  // Monthly base salary. null means this employee isn't tracked in payroll.
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

  // Employee Core (HR) fields — additive, independent of login/role fields above.
  @IsString()
  @IsOptional()
  employee_number?: string | null;

  @IsString()
  @IsOptional()
  phone?: string | null;

  @IsString()
  @IsOptional()
  identity_number?: string | null;

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
  attendance_enabled?: boolean;
}