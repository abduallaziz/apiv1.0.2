import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsUUID,
  IsIn,
  IsNumber,
  Min,
  IsArray,
} from 'class-validator';

export class CreateLocationDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  zone?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  // Structural hierarchy (existing, migration 097) — kept unchanged.
  @IsUUID()
  @IsOptional()
  parent_location_id?: string;

  @IsIn(['zone', 'aisle', 'rack', 'shelf', 'bin'])
  @IsOptional()
  location_type?: 'zone' | 'aisle' | 'rack' | 'shelf' | 'bin';

  // Functional purpose (new, migration 169) — independent of location_type.
  @IsIn([
    'receiving',
    'storage',
    'picking',
    'packing',
    'quality_hold',
    'damaged',
    'shipping',
  ])
  @IsOptional()
  location_purpose?: string;

  @IsNumber()
  @Min(0.0001)
  @IsOptional()
  max_quantity?: number;

  @IsNumber()
  @Min(0.0001)
  @IsOptional()
  max_weight?: number;

  @IsNumber()
  @Min(0.0001)
  @IsOptional()
  max_volume?: number;

  // Restriction shortcuts — item/category IDs allowed at this location.
  // Applied as warehouse_location_restrictions rows by the service.
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  restricted_to_item_ids?: string[];

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  restricted_to_category_ids?: string[];
}
