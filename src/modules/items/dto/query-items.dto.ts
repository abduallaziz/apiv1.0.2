import {
  IsOptional,
  IsUUID,
  IsIn,
  IsString,
  IsInt,
  Min,
  Max,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ItemType } from './create-item.dto';

/** Whitelisted sort columns. Raw input must never reach .order(). */
export const ITEM_SORT_COLUMNS = [
  'name',
  'price',
  'created_at',
  'sku',
] as const;
export type ItemSortColumn = (typeof ITEM_SORT_COLUMNS)[number];

export class QueryItemsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  // Deliberately snake_case: the previous controller read @Query('per_page'),
  // so renaming it would silently break every existing caller.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  per_page?: number = 50;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(ItemType)
  type?: ItemType;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  // Tri-state, and the default is what preserves existing behaviour: every
  // consumer that sends nothing keeps receiving active-only items, exactly as
  // the previously hardcoded .eq('is_active', true) did.
  @IsOptional()
  @IsIn(['true', 'false', 'all'])
  is_active?: 'true' | 'false' | 'all' = 'true';

  @IsOptional()
  @IsIn(ITEM_SORT_COLUMNS)
  sort?: ItemSortColumn = 'name';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc' = 'asc';
}
