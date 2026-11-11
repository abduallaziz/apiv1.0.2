import {
  IsUUID,
  IsOptional,
  IsNumber,
  Min,
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TransferLineDto {
  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsUUID()
  @IsOptional()
  batch_id?: string;

  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @IsUUID()
  @IsOptional()
  from_location_id?: string;

  @IsUUID()
  @IsOptional()
  to_location_id?: string;

  // Set when this line was entered by scanning a packaging-level barcode
  // (Box/Carton/Pallet). `quantity` is still interpreted in the item's
  // storage unit for backward compatibility — when this is set, `quantity`
  // is instead the count of that packaging level (e.g. "2 Cartons"), and
  // TransfersService resolves it into the storage-unit-equivalent before
  // ever reaching the transfer RPC chain.
  @IsUUID()
  @IsOptional()
  packaging_level_id?: string;
}

export class CreateTransferDto {
  @IsUUID()
  from_warehouse_id: string;

  @IsUUID()
  to_warehouse_id: string;

  @IsString()
  @IsNotEmpty()
  transfer_number: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  items: TransferLineDto[];
}
