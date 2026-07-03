import { IsUUID, IsString, IsInt, Min, MaxLength, IsOptional, IsDateString } from 'class-validator';

export class CreateReservationDto {
  @IsUUID()
  table_id: string;

  @IsString()
  @MaxLength(100)
  customer_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  customer_phone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  party_size?: number;

  @IsDateString()
  reservation_time: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
