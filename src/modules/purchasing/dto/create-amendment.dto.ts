import {
  IsUUID,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  IsDateString,
  IsIn,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AmendmentLineDto {
  @IsIn(['modify', 'add', 'discontinue'])
  action: 'modify' | 'add' | 'discontinue';

  // Required for modify/discontinue (references an EXISTING agreement_item).
  // Must be absent for add.
  @ValidateIf((o: AmendmentLineDto) => o.action !== 'add')
  @IsUUID()
  agreement_item_id?: string;

  // Required for add (the new item being introduced to the agreement).
  // Must be absent for modify/discontinue.
  @ValidateIf((o: AmendmentLineDto) => o.action === 'add')
  @IsUUID()
  item_id?: string;

  @ValidateIf((o: AmendmentLineDto) => o.action === 'add')
  @IsOptional()
  @IsUUID()
  variant_id?: string;

  // modify: additive delta on top of the existing value.
  // add: the item's initial committed value (direct set, not a delta).
  // discontinue: must be omitted.
  @ValidateIf((o: AmendmentLineDto) => o.action !== 'discontinue')
  @IsOptional()
  @IsNumber()
  delta_committed_quantity?: number;

  @ValidateIf((o: AmendmentLineDto) => o.action !== 'discontinue')
  @IsOptional()
  @IsNumber()
  delta_committed_value?: number;

  // modify only -- recorded as an audit-trail override; applying it to
  // live agreement_pricing is deferred to a future phase (out of scope
  // for 9.5.6.2, matching the 9.5.6.1 decision to leave agreement_pricing
  // untouched).
  @ValidateIf((o: AmendmentLineDto) => o.action === 'modify')
  @IsOptional()
  @IsNumber()
  @Min(0)
  new_unit_price?: number;

  @ValidateIf((o: AmendmentLineDto) => o.action === 'modify')
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(99.99)
  new_discount_percent?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateAmendmentDto {
  @IsUUID()
  agreement_id: string;

  @IsString()
  @IsNotEmpty()
  amendment_number: string;

  @IsIn([
    'quantity_change',
    'value_change',
    'price_change',
    'extension',
    'administrative_correction',
    'general',
  ])
  amendment_type: string;

  @IsDateString()
  @IsOptional()
  new_expiration_date?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AmendmentLineDto)
  items: AmendmentLineDto[];
}
