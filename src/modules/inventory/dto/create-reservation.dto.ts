import { IsUUID, IsOptional, IsNumber, Min, IsString, IsNotEmpty, IsDateString } from 'class-validator';

export class CreateReservationDto {
  @IsUUID()
  warehouse_id: string;

  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  variant_id?: string;

  @IsUUID()
  @IsOptional()
  batch_id?: string;

  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @IsString()
  @IsNotEmpty()
  reference_type: string;

  @IsUUID()
  reference_id: string;

  @IsDateString()
  @IsOptional()
  expires_at?: string;
}
