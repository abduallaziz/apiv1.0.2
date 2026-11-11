import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateExpenseCategoryDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
