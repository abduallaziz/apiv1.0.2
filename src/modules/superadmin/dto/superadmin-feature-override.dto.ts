import { IsBoolean, IsOptional, IsNumber, IsString } from 'class-validator';

export class FeatureOverrideDto {
  @IsOptional()
  @IsBoolean()
  is_enabled?: boolean;

  @IsOptional()
  @IsNumber()
  limit_value?: number;

  @IsOptional()
  @IsString()
  note?: string;
}