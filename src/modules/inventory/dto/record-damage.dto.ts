import { IsNumber, Min, IsString, IsNotEmpty } from 'class-validator';

export class RecordDamageDto {
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
