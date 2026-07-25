import {
  IsUUID,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  IsArray,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AwardLineDto {
  @IsUUID()
  @IsOptional()
  rfq_item_id?: string;

  // The award snapshots pricing FROM this quote line server-side at the
  // moment of award — the client only says which line and how much, it
  // never submits the price/discount/currency/lead_time/tax itself. This
  // is what makes the award a true point-in-time historical record,
  // immune to the supplier later editing their quote.
  @IsUUID()
  source_supplier_quote_item_id: string;

  @IsNumber()
  @Min(0.0001)
  awarded_quantity: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateAwardDto {
  @IsUUID()
  rfq_id: string;

  @IsString()
  @IsNotEmpty()
  award_number: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AwardLineDto)
  items: AwardLineDto[];
}
