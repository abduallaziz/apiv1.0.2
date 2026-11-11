import { IsOptional, IsString, IsInt, IsIn, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

// Inventory #7 / F17 (Owner-approved) — server-side pagination/sort/filter
// contract for WMS list endpoints. Mirrors the existing page-based
// convention already used by customers/items/transfers (page, limit,
// sortBy, sortOrder) exactly — no new pagination architecture invented.
// Every field is optional and defaults to the pre-existing unpaginated
// behavior when `page` is omitted, so existing callers (the current
// features/wms WmsPage.tsx tabs) are unaffected.

export const SHIPMENT_SORT_FIELDS = ['created_at', 'status'] as const;
export type ShipmentSortField = (typeof SHIPMENT_SORT_FIELDS)[number];

export class ShipmentsQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() warehouse_id?: string;
  @IsOptional() @IsString() date_from?: string;
  @IsOptional() @IsString() date_to?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
  @IsOptional() @IsIn(SHIPMENT_SORT_FIELDS) sortBy?: ShipmentSortField = 'created_at';
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder?: 'asc' | 'desc' = 'desc';
}

export const PICK_LIST_SORT_FIELDS = ['created_at', 'priority'] as const;
export type PickListSortField = (typeof PICK_LIST_SORT_FIELDS)[number];

export class PickListsQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() warehouse_id?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() strategy?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
  @IsOptional() @IsIn(PICK_LIST_SORT_FIELDS) sortBy?: PickListSortField = 'created_at';
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder?: 'asc' | 'desc' = 'desc';
}

export const WAVE_SORT_FIELDS = ['created_at', 'status'] as const;
export type WaveSortField = (typeof WAVE_SORT_FIELDS)[number];

export class WavesQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() warehouse_id?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
  @IsOptional() @IsIn(WAVE_SORT_FIELDS) sortBy?: WaveSortField = 'created_at';
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder?: 'asc' | 'desc' = 'desc';
}

export const WAREHOUSE_TASK_SORT_FIELDS = ['created_at', 'priority', 'status'] as const;
export type WarehouseTaskSortField = (typeof WAREHOUSE_TASK_SORT_FIELDS)[number];

export class WarehouseTasksQueryDto {
  @IsOptional() @IsString() task_type?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() assigned_to?: string;
  @IsOptional() @IsString() warehouse_id?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
  @IsOptional() @IsIn(WAREHOUSE_TASK_SORT_FIELDS) sortBy?: WarehouseTaskSortField = 'created_at';
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder?: 'asc' | 'desc' = 'desc';
}

export const EXCEPTION_SORT_FIELDS = ['created_at', 'exception_type'] as const;
export type ExceptionSortField = (typeof EXCEPTION_SORT_FIELDS)[number];

export class ExceptionsQueryDto {
  @IsOptional() @IsString() entity_type?: string;
  @IsOptional() @IsString() entity_id?: string;
  @IsOptional() @IsString() exception_type?: string;
  @IsOptional() @IsString() warehouse_id?: string;
  @IsOptional() @IsString() date_from?: string;
  @IsOptional() @IsString() date_to?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
  @IsOptional() @IsIn(EXCEPTION_SORT_FIELDS) sortBy?: ExceptionSortField = 'created_at';
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder?: 'asc' | 'desc' = 'desc';
}

export class DashboardExceptionsDrillDownQueryDto {
  @IsOptional() @IsString() warehouse_id?: string;
  @IsOptional() @IsString() exception_type?: string;
  @IsOptional() @IsString() entity_type?: string;
  @IsOptional() @IsString() date_from?: string;
  @IsOptional() @IsString() date_to?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number = 50;
  @IsOptional() @IsIn(EXCEPTION_SORT_FIELDS) sortBy?: ExceptionSortField = 'created_at';
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder?: 'asc' | 'desc' = 'desc';
}

export interface PagedResult<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
}
