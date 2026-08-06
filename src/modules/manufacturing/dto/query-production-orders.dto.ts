import { IsOptional, IsUUID, IsIn, IsString, IsDateString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/** Whitelisted sort columns — raw input must never reach .order(). */
export const PRODUCTION_ORDER_SORT_COLUMNS = ['order_number', 'status', 'scheduled_date', 'created_at'] as const;
export type ProductionOrderSortColumn = (typeof PRODUCTION_ORDER_SORT_COLUMNS)[number];

export class QueryProductionOrdersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage?: number = 50;

  @IsOptional()
  @IsIn(['draft', 'in_progress', 'completed', 'cancelled'])
  status?: 'draft' | 'in_progress' | 'completed' | 'cancelled';

  @IsOptional()
  @IsUUID()
  warehouse_id?: string;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(PRODUCTION_ORDER_SORT_COLUMNS as unknown as string[])
  sort?: ProductionOrderSortColumn = 'created_at';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc' = 'desc';
}
