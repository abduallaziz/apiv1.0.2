import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';

export class DineInItemDto {
  @IsUUID()
  item_id: string;

  @IsString()
  item_name: string;

  @IsOptional()
  @IsUUID()
  variant_id?: string;

  @IsOptional()
  @IsString()
  variant_name?: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  unit_price: number;
}

export class AddDineInItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DineInItemDto)
  items: DineInItemDto[];
}
