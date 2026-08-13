import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateTemplateDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}
