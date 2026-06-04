import { IsString, IsNotEmpty } from 'class-validator';

export class RejectExpenseDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}