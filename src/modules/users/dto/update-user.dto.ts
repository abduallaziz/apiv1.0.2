import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min, Max, MinLength } from 'class-validator';
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

  // Stored as a fraction (0-1), e.g. 0.05 for 5%. null clears it (no commission).
  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  commission_rate?: number | null;
}