import { IsUUID, IsString, IsNotEmpty, IsOptional, IsIn, IsArray, ArrayMinSize } from 'class-validator';

export const STOCK_COUNT_TYPES = ['full', 'partial', 'cycle'] as const;
export type StockCountType = (typeof STOCK_COUNT_TYPES)[number];

export class CreateStockCountDto {
  @IsUUID()
  warehouse_id: string;

  @IsString()
  @IsNotEmpty()
  count_number: string;

  @IsString()
  @IsOptional()
  notes?: string;

  // Preserves current behavior when omitted: the column already defaults
  // to 'full' at the DB level (migration 107), so an absent value here
  // reaches the repository as undefined and the existing full-warehouse
  // snapshot logic runs completely unchanged.
  @IsIn(STOCK_COUNT_TYPES)
  @IsOptional()
  count_type?: StockCountType;

  // Scope for partial/cycle counts. Ignored for 'full'. At least one of
  // these is required when count_type is 'partial' or 'cycle' — otherwise
  // the "type" would be meaningless (identical scope to a full count).
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  @IsOptional()
  item_ids?: string[];

  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  @IsOptional()
  location_ids?: string[];
}
