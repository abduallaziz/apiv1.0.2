import { IsString, IsOptional, IsDateString } from 'class-validator';

export class UpdatePurchaseOrderDto {
  @IsDateString()
  @IsOptional()
  expected_date?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
