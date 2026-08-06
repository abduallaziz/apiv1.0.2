import { IsIn, IsOptional, IsUUID, IsString } from 'class-validator';

export class TransferOwnershipDto {
  @IsIn(['company', 'consignment', 'customer'])
  ownership_type: 'company' | 'consignment' | 'customer';

  @IsUUID()
  @IsOptional()
  owner_customer_id?: string;

  @IsUUID()
  @IsOptional()
  owner_supplier_id?: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
