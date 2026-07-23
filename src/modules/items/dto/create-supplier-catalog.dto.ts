import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsUUID,
  IsBoolean,
  IsOptional,
} from 'class-validator';
import { BarcodeType } from './create-item-barcode.dto';

export class CreateSupplierCatalogDto {
  @IsUUID()
  @IsOptional()
  supplier_id?: string;

  @IsUUID()
  @IsOptional()
  item_id?: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsString()
  @IsOptional()
  catalog_code?: string;

  @IsString()
  @IsNotEmpty()
  barcode: string;

  @IsEnum(BarcodeType)
  @IsOptional()
  barcode_type?: BarcodeType;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}
