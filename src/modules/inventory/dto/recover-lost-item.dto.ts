import { IsNumber, Min, IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class RecoverLostItemDto {
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsNumber()
  @IsOptional()
  unit_cost?: number;
}
