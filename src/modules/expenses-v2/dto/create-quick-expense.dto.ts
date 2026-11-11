import { IsNumber, IsOptional, IsPositive, IsUUID } from 'class-validator';

// Manual Quick Expense entry (this build's only supported trigger context —
// the future POS trigger is locked-design-only, not implemented here).
// `amount` is required for a 'variable' definition and forbidden for a
// 'fixed' one (enforced in ExpensesV2Service.createFromQuick, since it
// depends on the referenced definition's amount_mode). Department/Category
// may be overridden — "User may change [Department] if permitted" is
// scoped to this exact Manual context per the locked design; permission is
// the same `expenses.create` already required to call this endpoint at all.
export class CreateQuickExpenseDto {
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsUUID()
  department_id?: string;

  @IsOptional()
  @IsUUID()
  category_id?: string;
}
