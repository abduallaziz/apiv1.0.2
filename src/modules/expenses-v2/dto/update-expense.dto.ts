import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

// Same field surface as create — `branch_id` cannot be edited either.
export class UpdateExpenseDto {
  @IsOptional()
  @IsUUID()
  department_id?: string;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsIn(['none', 'inclusive', 'exclusive'])
  tax_mode?: 'none' | 'inclusive' | 'exclusive';

  @IsOptional()
  @IsString()
  @MaxLength(60)
  payment_method?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference_number?: string;

  // Only meaningful when the Expense is already recurring — lets an
  // in-flight recurring Expense's schedule be adjusted. `is_recurring`
  // itself is deliberately absent here, same pattern as `payment_status`:
  // the only way to turn recurrence off is the dedicated
  // `PATCH .../stop-recurring` action, never the generic edit endpoint.
  @IsOptional()
  @IsIn(['daily', 'weekly', 'monthly', 'yearly'])
  frequency?: 'daily' | 'weekly' | 'monthly' | 'yearly';

  @IsOptional()
  @IsDateString()
  recurring_end_date?: string;

  // Expense Date — editable independently of created_at (never editable,
  // absent from this DTO).
  @IsOptional()
  @IsDateString()
  expense_date?: string;
}
