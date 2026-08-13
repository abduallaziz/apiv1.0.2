import {
  IsUUID,
  IsOptional,
  IsNumber,
  Min,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ConvertSuggestionLineDto {
  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsNumber()
  @Min(0.0001)
  quantity_requested: number;
}

export class ConvertSuggestionsDto {
  @IsUUID()
  @IsOptional()
  branch_id?: string;

  @IsUUID()
  @IsOptional()
  warehouse_id?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConvertSuggestionLineDto)
  items: ConvertSuggestionLineDto[];
}
