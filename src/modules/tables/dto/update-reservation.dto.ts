import { IsString, IsInt, Min, MaxLength, IsOptional, IsDateString, IsIn } from 'class-validator';

export class UpdateReservationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  customer_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  customer_phone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  party_size?: number;

  @IsOptional()
  @IsDateString()
  reservation_time?: string;

  @IsOptional()
  @IsIn(['confirmed', 'seated', 'cancelled', 'no_show'])
  status?: 'confirmed' | 'seated' | 'cancelled' | 'no_show';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
