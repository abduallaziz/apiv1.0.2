import { IsString, IsOptional, IsBoolean, IsIn, IsArray, IsInt, MaxLength } from 'class-validator';

export class UpdateFieldDefinitionDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label_ar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label_en?: string;

  @IsOptional()
  @IsIn(['text', 'number', 'date', 'select', 'boolean'])
  field_type?: 'text' | 'number' | 'date' | 'select' | 'boolean';

  @IsOptional()
  @IsArray()
  options?: { value: string; label_ar: string; label_en: string }[];

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsIn(['phone', 'email', 'plate_number', 'visit_date', 'odometer', null])
  contact_role?: 'phone' | 'email' | 'plate_number' | 'visit_date' | 'odometer' | null;
}
