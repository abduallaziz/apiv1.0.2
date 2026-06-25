import { IsString, IsOptional, IsBoolean, IsIn, IsArray, IsInt, MaxLength, Matches } from 'class-validator';

export class CreateFieldDefinitionDto {
  @IsString()
  @MaxLength(50)
  @Matches(/^[a-z][a-z0-9_]*$/, { message: 'field_key must be lowercase snake_case (e.g. national_id)' })
  field_key: string;

  @IsString()
  @MaxLength(100)
  label_ar: string;

  @IsString()
  @MaxLength(100)
  label_en: string;

  @IsIn(['text', 'number', 'date', 'select', 'boolean'])
  field_type: 'text' | 'number' | 'date' | 'select' | 'boolean';

  @IsOptional()
  @IsArray()
  options?: { value: string; label_ar: string; label_en: string }[];

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsIn(['phone', 'email'])
  contact_role?: 'phone' | 'email';
}
