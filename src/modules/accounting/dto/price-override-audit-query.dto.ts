import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

// Accounting Backend Phase 1 — GET /accounting/price-override-audit filters.
// price_override_audit already carries tenant_id/branch_id directly
// (migration 191) — no join needed for branch scoping, unlike journal_entries.
export class PriceOverrideAuditQueryDto {
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
  per_page?: number = 50;

  @IsOptional()
  @IsISO8601()
  date_from?: string;

  @IsOptional()
  @IsISO8601()
  date_to?: string;

  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @IsUUID()
  order_id?: string;

  @IsOptional()
  @IsUUID()
  item_id?: string;

  @IsOptional()
  @IsUUID()
  actor_id?: string;

  @IsOptional()
  @IsUUID()
  actor_role_id?: string;

  @IsOptional()
  @IsIn(['discount', 'increase'])
  direction?: 'discount' | 'increase';

  @IsOptional()
  @Type(() => Number)
  difference_percent_min?: number;

  @IsOptional()
  @Type(() => Number)
  difference_percent_max?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
