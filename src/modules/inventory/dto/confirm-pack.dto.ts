import { IsNumber, Min } from 'class-validator';

export class ConfirmPackDto {
  @IsNumber()
  @Min(0.0001)
  quantity: number;
}
