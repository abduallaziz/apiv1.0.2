import { IsUUID, IsIn, IsOptional, IsNumber, Min, IsString } from 'class-validator';

export class CreateOwnershipLayerDto {
  @IsUUID()
  warehouse_id: string;

  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsIn(['consignment', 'customer'])
  ownership_type: 'consignment' | 'customer';

  @IsUUID()
  @IsOptional()
  owner_customer_id?: string;

  @IsUUID()
  @IsOptional()
  owner_supplier_id?: string;

  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @IsString()
  @IsOptional()
  reason?: string;
}
