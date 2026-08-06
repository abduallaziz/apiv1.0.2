import { IsUUID, IsOptional, IsNumber, Min, IsString, IsNotEmpty, IsDateString } from 'class-validator';

export class CreateProductionOrderDto {
  @IsUUID()
  warehouse_id: string;

  @IsUUID()
  bom_id: string;

  @IsUUID()
  @IsOptional()
  work_center_id?: string;

  @IsString()
  @IsNotEmpty()
  order_number: string;

  @IsNumber()
  @Min(0.0001)
  quantity_planned: number;

  @IsDateString()
  @IsOptional()
  scheduled_date?: string;

  @IsUUID()
  @IsOptional()
  source_location_id?: string;

  @IsUUID()
  @IsOptional()
  staging_location_id?: string;

  @IsUUID()
  @IsOptional()
  output_location_id?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
