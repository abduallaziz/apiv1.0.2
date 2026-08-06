import { IsEnum, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export enum OutputType {
  BY_PRODUCT = 'by_product',
}

// main_product rows are inserted automatically by the service layer at
// completion time (mirroring what fn_post_production_order already
// posted) — clients only ever create by_product rows through this DTO,
// so output_type isn't even a field here; the service always sets it.
export class CreateOutputDto {
  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @IsNumber()
  @Min(0)
  unit_cost: number;
}
