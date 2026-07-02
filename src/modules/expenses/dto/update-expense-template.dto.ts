import { PartialType } from '@nestjs/mapped-types';
import { CreateExpenseTemplateDto } from './create-expense-template.dto';
import { IsOptional, IsBoolean } from 'class-validator';

export class UpdateExpenseTemplateDto extends PartialType(CreateExpenseTemplateDto) {
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}