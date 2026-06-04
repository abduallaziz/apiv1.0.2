import { IsOptional, IsString, IsInt, Min, Max, IsDateString, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class AuditQueryDto {
  @IsOptional()
  @IsUUID()
  actor_id?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  resource_type?: string;

  @IsOptional()
  @IsUUID()
  tenant_id?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}