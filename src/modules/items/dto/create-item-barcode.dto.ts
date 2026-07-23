import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsUUID,
  IsBoolean,
  IsOptional,
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
  barcode: string;

  @IsEnum(BarcodeType)
  @IsOptional()
  barcode_type?: BarcodeType;

  @IsBoolean()
  @IsOptional()
  is_primary?: boolean;
}
