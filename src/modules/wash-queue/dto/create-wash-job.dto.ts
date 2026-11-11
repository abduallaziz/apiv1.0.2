import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateWashJobDto {
  @IsUUID()
  branch_id: string;

  @IsString()
  @MaxLength(32)
  plate: string;

  @IsString()
  @IsOptional()
  @MaxLength(32)
  vehicle_size?: string;

  // Link an existing (sale) order; customer defaults to the order's customer.
  @IsUUID()
  @IsOptional()
  order_id?: string;

  @IsUUID()
  @IsOptional()
  customer_id?: string;

  @IsUUID()
  @IsOptional()
  assigned_worker_id?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
