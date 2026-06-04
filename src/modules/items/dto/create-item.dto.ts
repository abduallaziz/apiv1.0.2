import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

export enum ItemType {
  PRODUCT = 'product',
  SERVICE = 'service',
  CUSTOM = 'custom',
}

export enum OperationType {
  SELL = 'sell',
  BOOK = 'book',
  REPAIR = 'repair',
  RENT = 'rent',
}

export class CreateItemDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(ItemType)
  type: ItemType;

  @IsEnum(OperationType)
  operation_type: OperationType;

  @IsNumber()
  @Min(0)
  price: number;

  @IsUUID()
  @IsOptional()
  category_id?: string;

  @IsBoolean()
  @IsOptional()
  has_inventory?: boolean;

  @IsBoolean()
  @IsOptional()
  has_variants?: boolean;
}