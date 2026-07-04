import { IsUUID, IsOptional, IsString, IsNumber, Min, MaxLength, IsDateString } from 'class-validator';

export class CreateEmployeeGeofenceDto {
  @IsUUID()
  user_id: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsNumber()
  center_lat: number;

  @IsNumber()
  center_lng: number;

  @IsNumber()
  @Min(1)
  radius_m: number;

  // Both omitted = always valid (a standing site for this employee).
  @IsOptional()
  @IsDateString()
  valid_from?: string;

  @IsOptional()
  @IsDateString()
  valid_to?: string;
}
