import { IsString, IsOptional, IsNumber, IsUUID, Min, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateExpenseDto {
  @IsUUID()
  branch_id: string;

  @IsOptional()
  @IsUUID()
  template_id?: string;

  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  photo_url?: string;
}