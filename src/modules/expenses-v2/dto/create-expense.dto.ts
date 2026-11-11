import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

// `branch_id` is deliberately absent — Branch is auto-derived server-side
// from the request's tenant/branch context and is never client-selectable
// (locked product rule, NEW EXPENSES design freeze).
export class CreateExpenseDto {
  @IsUUID()
  department_id: string;

  @IsUUID()
  category_id: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsIn(['none', 'inclusive', 'exclusive'])
  tax_mode: 'none' | 'inclusive' | 'exclusive';

  @IsString()
  @MaxLength(60)
  payment_method: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference_number?: string;

  // Defaults to 'paid' if omitted (locked product rule). The only way to
  // transition an existing Expense's payment state afterward is the
  // dedicated `PATCH .../confirm-payment` action (Step 7) — payment_status
  // is deliberately absent from UpdateExpenseDto so the general edit
  // endpoint can never silently flip it.
  @IsOptional()
  @IsIn(['paid', 'unpaid'])
  payment_status?: 'paid' | 'unpaid';

  // Recurring Expenses Final Implementation (Owner Decision): a recurring
  // Expense is this same Expense record with recurring behavior enabled —
  // there is no separate Template entity. `next_occurrence_date` is never
  // client-supplied (computed server-side from today + frequency, same
  // "never trust the client for derived scheduling state" principle as
  // Branch/next_occurrence_date always were).
  @IsOptional()
  @IsBoolean()
  is_recurring?: boolean;

  @ValidateIf((o: CreateExpenseDto) => o.is_recurring === true)
  @IsIn(['daily', 'weekly', 'monthly', 'yearly'])
  frequency?: 'daily' | 'weekly' | 'monthly' | 'yearly';

  @IsOptional()
  @IsDateString()
  recurring_end_date?: string;

  // Expense Date (Owner-approved final implementation): the date the
  // Expense actually happened, fully independent of created_at (record
  // entry timestamp — never client-writable, not exposed on this DTO).
  // Defaults to today server-side when omitted.
  @IsOptional()
  @IsDateString()
  expense_date?: string;

  // Phase 5 / T8 (owner approved 2026-11-09): the OPEN register (shift) the
  // cash was paid out of. Optional: cash paid from a safe or petty cash that
  // is not in a cashier's drawer simply has no register. Only for CASH,
  // PAID expenses; the register must be open and in the expense's branch.
  // A linked cash expense reduces that register's expected cash at close.
  @IsOptional()
  @IsUUID()
  shift_id?: string;
}
