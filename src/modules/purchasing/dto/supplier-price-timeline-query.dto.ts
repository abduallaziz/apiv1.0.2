import { IsOptional, IsUUID, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

// #9.6 Supplier Price History & Procurement Price Timeline (Owner-approved,
// expanded scope). Bounded, page-based contract mirroring the F17
// convention used elsewhere (page/limit) — the timeline is assembled from
// three real, already-existing tables (no new table, no migration), so
// page/limit here bound the in-memory merge, not a single SQL query.
export class SupplierPriceTimelineQueryDto {
  @IsOptional()
  @IsUUID()
  variant_id?: string;

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
}
