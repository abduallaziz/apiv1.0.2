import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateScrapDto {
  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @IsString()
  @IsOptional()
  reason?: string;
}
