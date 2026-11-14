import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsUUID,
  IsBoolean,
  IsOptional,
  MaxLength,
} from 'class-validator';

export enum BarcodeType {
  UPC = 'UPC',
  EAN = 'EAN',
  GS1 = 'GS1',
  QR = 'QR',
}

export class CreateItemBarcodeDto {
  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  barcode: string;

  @IsEnum(BarcodeType)
  @IsOptional()
  barcode_type?: BarcodeType;

  @IsBoolean()
  @IsOptional()
  is_primary?: boolean;

  // Set only when this barcode represents a packaging level (Box/Carton/
  // Pallet/...) rather than a single sellable unit. Must belong to the
  // same item_id — validated in ItemBarcodesService.create()/update().
  @IsUUID()
  @IsOptional()
  packaging_level_id?: string;
}
