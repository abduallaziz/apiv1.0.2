import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

// Step 9 — Backend API completion: the search/filter surface locked in
// the design freeze ("Branch=Madinah AND Department=Operations AND
// Category=Utilities AND Date=August", "Department=Marketing AND
// Category=Advertising AND Date=Q3"), all combinable. `branch_id` here is
// an unrestricted filter, not an authorization boundary — cross-branch
// access control depends on G1 (Branch Accounting Isolation), which is
// documented as not yet implemented, not silently assumed solved.
export class FilterExpensesDto {
  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @IsUUID()
  department_id?: string;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsIn(['manual', 'quick', 'recurring', 'pos'])
  source?: string;

  @IsOptional()
  @IsIn(['paid', 'unpaid'])
  payment_status?: 'paid' | 'unpaid';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  amount_min?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  amount_max?: number;

  // Unset by default (matches findAll()'s pre-existing behavior — cancelled
  // Expenses are included unless explicitly excluded here, so this filter
  // is purely additive and doesn't change what Step 4/7 already validated).
  @IsOptional()
  @IsBooleanString()
  exclude_cancelled?: string;

  // Powers the Recurring Expenses management page — a filtered view of the
  // same Expenses list/domain, not a separate entity or endpoint.
  @IsOptional()
  @IsBooleanString()
  is_recurring?: string;

  @IsOptional()
  @IsIn(['expense_date', 'total_amount', 'created_at', 'title'])
  sort_by?: 'expense_date' | 'total_amount' | 'created_at' | 'title';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_dir?: 'asc' | 'desc';
}
