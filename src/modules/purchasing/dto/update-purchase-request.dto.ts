import { IsString, IsOptional, IsUUID } from 'class-validator';

export class UpdatePurchaseRequestDto {
  @IsUUID()
  @IsOptional()
  branch_id?: string;

  @IsUUID()
  @IsOptional()
  warehouse_id?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
