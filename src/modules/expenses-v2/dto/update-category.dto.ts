import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

// No `DELETE` counterpart — same deactivate-not-delete rule as Departments,
// enforced by the guard trigger on expense_categories_v2.
export class UpdateExpenseCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
