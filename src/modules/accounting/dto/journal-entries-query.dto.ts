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

// Accounting Backend Phase 1 — list filters for GET /accounting/journal-entries
// and (with source_module/source_entity_type pre-filled by the controller)
// GET /accounting/sales-posting and GET /accounting/cogs-reconciliation.
// Every field here maps directly to an existing journal_entries/journal_lines
// column or a one-hop join (branch, via orders) — no invented field.
export class JournalEntriesQueryDto {
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
  fiscal_period_id?: string;

  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @IsUUID()
  account_id?: string;

  @IsOptional()
  @IsString()
  source_module?: string;

  @IsOptional()
  @IsIn(['draft', 'posted', 'reversed'])
  status?: 'draft' | 'posted' | 'reversed';

  @IsOptional()
  @Type(() => Number)
  amount_min?: number;

  @IsOptional()
  @Type(() => Number)
  amount_max?: number;

  @IsOptional()
  @IsUUID()
  created_by?: string;

  // Internal — set by the controller for /sales-posting and
  // /cogs-reconciliation, never accepted directly from the client on
  // those routes (a plain query filter, not a security boundary of its
  // own — tenant scoping is what actually protects the data).
  @IsOptional()
  requires_cogs_reconciliation?: boolean;
}
