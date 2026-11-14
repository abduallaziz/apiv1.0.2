import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsUUID,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// Upper bound for any money field. The numeric columns overflow (HTTP 500) well
// above this, so reject early with a clean 400.
export const MAX_MONEY_VALUE = 99_999_999;

// Mirrors items.costing_method's CHECK constraint exactly (migration 111).
// The consumption/add-layer engine itself is untouched by this migration —
// this only exposes the existing values through the API.
export enum CostingMethod {
  FIFO = 'fifo',
  AVERAGE = 'average',
  MOVING_AVERAGE = 'moving_average',
  STANDARD = 'standard',
  ACTUAL = 'actual',
}

export enum ItemType {
  PRODUCT = 'product',
  SERVICE = 'service',
  CUSTOM = 'custom',
  RAW_MATERIAL = 'raw_material',
  SEMI_FINISHED = 'semi_finished',
  FINISHED_GOODS = 'finished_goods',
  ASSET = 'asset',
  CONSUMABLE = 'consumable',
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
  @MaxLength(200)
  name: string;

  @IsEnum(ItemType)
  type: ItemType;

  @IsEnum(OperationType)
  operation_type: OperationType;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_MONEY_VALUE)
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

  @IsUUID()
  @IsOptional()
  storage_unit_id?: string;

  @IsUUID()
  @IsOptional()
  purchase_unit_id?: string;

  @IsNumber()
  @Min(0.0001)
  @IsOptional()
  purchase_unit_factor?: number;

  @IsUUID()
  @IsOptional()
  sale_unit_id?: string;

  @IsNumber()
  @Min(0.0001)
  @IsOptional()
  sale_unit_factor?: number;

  // Empty/omitted = auto-generated (migration 139: fn_next_sku_seq).
  // A value here is stored as a manual override (sku_source='manual').
  @IsString()
  @IsOptional()
  @MaxLength(64)
  sku?: string;

  // Product image link. Upload is not supported yet; a plain https URL is.
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2000)
  image_url?: string;

  // Omitted = DB default 'fifo' (unchanged existing behavior). Cross-field
  // "standard_cost required when standard" validation happens in
  // ItemsService, not here — class-validator has no clean built-in for
  // conditional-on-another-field without a custom decorator, and the
  // service already validates against the full picture on update too
  // (PartialType makes both fields optional there).
  @IsEnum(CostingMethod)
  @IsOptional()
  costing_method?: CostingMethod;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_MONEY_VALUE)
  @IsOptional()
  standard_cost?: number;
}
