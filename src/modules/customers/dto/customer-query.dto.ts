import { IsOptional, IsString, IsInt, IsIn, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export const CUSTOMER_SORT_FIELDS = [
  'full_name',
  'created_at',
  'loyalty_points',
  'total_spent',
] as const;
export type CustomerSortField = (typeof CUSTOMER_SORT_FIELDS)[number];

export class CustomerQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

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
  limit?: number = 20;

  // Additive — omitting it preserves the existing default (created_at desc),
  // so every existing caller is unaffected.
  @IsOptional()
  @IsIn(CUSTOMER_SORT_FIELDS)
  sortBy?: CustomerSortField = 'created_at';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
