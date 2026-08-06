import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

// Only unposted (movement_id IS NULL) outputs can be edited — enforced in
// OutputsService, not here.
export class UpdateOutputDto {
  @IsUUID()
  @IsOptional()
  item_id?: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsNumber()
  @Min(0.0001)
  @IsOptional()
  quantity?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  unit_cost?: number;
}
