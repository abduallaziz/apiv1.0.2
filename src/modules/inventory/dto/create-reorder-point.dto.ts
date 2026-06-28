import { IsUUID, IsOptional, IsNumber, Min } from 'class-validator';

export class CreateReorderPointDto {
  @IsUUID()
  warehouse_id: string;

  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsNumber()
  @Min(0)
  min_quantity: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  max_quantity?: number;

  @IsNumber()
  @Min(0)
  reorder_quantity: number;
}
