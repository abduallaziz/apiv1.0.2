import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
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
}