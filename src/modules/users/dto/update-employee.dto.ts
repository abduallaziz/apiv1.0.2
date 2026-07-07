import { IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

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
}
