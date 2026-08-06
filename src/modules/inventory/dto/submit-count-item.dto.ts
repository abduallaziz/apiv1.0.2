import { IsNumber, Min, IsUUID, IsOptional } from 'class-validator';

export class SubmitCountItemDto {
  @IsNumber()
  @Min(0)
  counted_quantity: number;

  @IsUUID()
  @IsOptional()
  reason_code_id?: string;
}
