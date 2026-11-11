import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

// No `DELETE` counterpart exists anywhere in this domain — deactivation
// (is_active=false) is the only path once a Department has ever been
// referenced, enforced at the DB level by the unconditional guard trigger
// on expense_departments (197_new_expenses_database_foundation.sql).
export class UpdateDepartmentDto {
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
