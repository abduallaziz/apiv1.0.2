import { IsNumber, Min } from 'class-validator';

export class ExtendTrialDto {
  @IsNumber()
  @Min(1)
  days: number;
}