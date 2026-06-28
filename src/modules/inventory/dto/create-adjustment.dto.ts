import { IsUUID, IsOptional, IsNumber, NotEquals, IsString, IsNotEmpty, Min } from 'class-validator';

export class CreateAdjustmentDto {
  @IsUUID()
  warehouse_id: string;

  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsUUID()
  @IsOptional()
  batch_id?: string;

  @IsNumber()
  @NotEquals(0)
  quantity_delta: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  unit_cost?: number;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
