import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class RejectExpenseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason: string;
}
