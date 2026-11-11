import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class UpdateQuickDefinitionDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsIn(['fixed', 'variable'])
  amount_mode?: 'fixed' | 'variable';

  @IsOptional()
  @IsIn(['none', 'inclusive', 'exclusive'])
  tax_mode?: 'none' | 'inclusive' | 'exclusive';

  @IsOptional()
  @IsNumber()
  @IsPositive()
  fixed_amount?: number;

  @IsOptional()
  @IsUUID()
  default_department_id?: string;

  @IsOptional()
  @IsUUID()
  default_category_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  default_payment_method?: string;

  @IsOptional()
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
