import { IsString, IsOptional, IsBoolean, IsNumber, Min, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateExpenseTemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  default_amount?: number;

  @IsOptional()
  @IsBoolean()
  requires_photo?: boolean;

  @IsNumber()
  @Min(1)
  @Type(() => Number)
  expiry_hours: number;
}