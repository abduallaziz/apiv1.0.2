import { IsNumber, IsString, Min, MinLength } from 'class-validator';

export class ValidateCouponDto {
  @IsString()
  @MinLength(2)
  code: string;

  @IsNumber()
  @Min(0)
  subtotal: number;
}
