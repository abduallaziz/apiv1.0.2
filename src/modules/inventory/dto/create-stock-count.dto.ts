import { IsUUID, IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateStockCountDto {
  @IsUUID()
  warehouse_id: string;

  @IsString()
  @IsNotEmpty()
  count_number: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
