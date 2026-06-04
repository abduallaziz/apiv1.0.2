import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CloseShiftDto {
  @IsNumber()
  @Min(0)
  closing_cash: number;

  @IsString()
  @IsOptional()
  notes?: string;
}