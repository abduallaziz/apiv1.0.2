import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';

export class UpdateBranchDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}