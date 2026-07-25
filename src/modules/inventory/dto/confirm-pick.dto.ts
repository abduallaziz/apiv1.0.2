import { IsNumber, Min } from 'class-validator';

export class ConfirmPickDto {
  @IsNumber()
  @Min(0.0001)
  quantity: number;
}
