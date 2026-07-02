import { IsString, IsOptional, IsNumber, IsUUID, Min, IsNotEmpty, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export enum ExpenseType {
  ONE_TIME = 'one_time',
  RECURRING = 'recurring',
}

export enum RecurrenceType {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

export class CreateExpenseDto {
  @IsUUID()
  branch_id: string;

  @IsUUID()
  @IsNotEmpty()
  category_id: string;

  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(ExpenseType)
  type: ExpenseType;

  @IsOptional()
  @IsEnum(RecurrenceType)
  recurrence?: RecurrenceType;

  @IsOptional()
  @IsString()
  photo_url?: string;

  @IsOptional()
  @IsUUID()
  shift_id?: string;
}