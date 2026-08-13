import { IsNumber, Min, IsUUID, IsOptional } from 'class-validator';

export class ConfirmPickDto {
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @IsUUID()
  @IsOptional()
  batch_id?: string;
}
