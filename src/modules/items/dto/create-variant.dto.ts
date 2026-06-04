import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsInt,
  Min,
} from 'class-validator';

export class CreateVariantDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @IsOptional()
  price_adjustment?: number;

  @IsString()
  @IsOptional()
  sku?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  stock_quantity?: number;
}