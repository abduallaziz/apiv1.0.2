import {
  IsUUID,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsString,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export class BomLineDto {
  @IsUUID()
  component_item_id: string;

  @IsUUID()
  @IsOptional()
  component_variant_id?: string;

  @IsNumber()
  @Min(0.0001)
  quantity_per_unit: number;

  @IsNumber()
  @Min(0)
  @Max(99.99)
  @IsOptional()
  scrap_percentage?: number;
}

export class CreateBomDto {
  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BomLineDto)
  lines: BomLineDto[];
}
