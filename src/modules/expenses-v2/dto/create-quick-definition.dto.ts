import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

// Locked pairing rule (mirrors the DB CHECK constraint on
// expense_quick_definitions): 'fixed' requires fixed_amount; 'variable'
// forbids it. `default_payment_method` is required at the application
// layer per the POS-flow lock ("Payment Method is now a required field on
// the Quick Definition itself") even though the column itself stays
// nullable at the DB level (no new migration authorized in this step).
export class CreateQuickDefinitionDto {
  @IsString()
  @MaxLength(80)
  label: string;

  @IsIn(['fixed', 'variable'])
  amount_mode: 'fixed' | 'variable';

  // Admin-configured only — never selected by the cashier/caller. The
  // Manual quick-entry endpoint always uses this stored value and rejects
  // any client-supplied tax_mode outright (CreateQuickExpenseDto has no
  // such field, so the whitelist strips/rejects it).
  @IsIn(['none', 'inclusive', 'exclusive'])
  tax_mode: 'none' | 'inclusive' | 'exclusive';

  @ValidateIf((o: CreateQuickDefinitionDto) => o.amount_mode === 'fixed')
  @IsNumber()
  @IsPositive()
  fixed_amount?: number;

  @IsOptional()
  @IsUUID()
  default_department_id?: string;

  @IsOptional()
  @IsUUID()
  default_category_id?: string;

  @IsString()
  @MaxLength(60)
  default_payment_method: string;

  @IsOptional()
  @IsInt()
  sort_order?: number;
}
