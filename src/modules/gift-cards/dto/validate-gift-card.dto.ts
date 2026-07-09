import { IsNumber, IsString, Min, MinLength } from 'class-validator';

export class ValidateGiftCardDto {
  @IsString()
  @MinLength(4)
  code: string;

  @IsNumber()
  @Min(0.01)
  amount: number;
}
