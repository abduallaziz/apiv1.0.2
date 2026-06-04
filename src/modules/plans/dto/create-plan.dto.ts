import { IsString, IsNumber, IsOptional, IsBoolean, Min } from 'class-validator';

export class CreatePlanDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  price_monthly: number;

  @IsNumber()
  @Min(0)
  price_yearly: number;

  @IsNumber()
  @Min(1)
  max_users: number;

  @IsNumber()
  @Min(1)
  max_branches: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  trial_days?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}