import {
  IsUUID,
  IsString,
  IsOptional,
  IsNumber,
  Min,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SupplierQuoteLineDto {
  @IsUUID()
  @IsOptional()
  rfq_item_id?: string;

  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsNumber()
  @Min(0.0001)
  quantity_offered: number;

  @IsNumber()
  @Min(0)
  unit_price: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  discount_percent?: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsNumber()
  @IsOptional()
  lead_time_days?: number;

  @IsNumber()
  @IsOptional()
  moq?: number;

  @IsNumber()
  @IsOptional()
  tax_rate?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateSupplierQuoteDto {
  @IsUUID()
  rfq_id: string;

  @IsUUID()
  supplier_id: string;

  // Required only the first time a quote for this (rfq, supplier) is
  // created — the number belongs to the quote_group (the stable
  // document identity) and stays the same across every later revision,
  // so it's ignored on subsequent calls once the group already exists.
  @IsString()
  @IsOptional()
  quote_number?: string;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsDateString()
  @IsOptional()
  expiration_date?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SupplierQuoteLineDto)
  items: SupplierQuoteLineDto[];
}
