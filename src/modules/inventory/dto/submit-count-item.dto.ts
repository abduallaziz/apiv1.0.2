import { IsNumber, Min } from 'class-validator';

export class SubmitCountItemDto {
  @IsNumber()
  @Min(0)
  counted_quantity: number;
}
