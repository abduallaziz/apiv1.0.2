import { IsOptional, IsString, IsIn, IsNumberString } from 'class-validator';

export class SuperAdminTenantsQueryDto {
  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['active', 'trial', 'suspended', 'cancelled'])
  status?: string;
}