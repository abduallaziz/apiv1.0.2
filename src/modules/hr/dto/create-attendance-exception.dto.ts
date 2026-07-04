import { IsUUID, IsDateString, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAttendanceExceptionDto {
  @IsUUID()
  user_id: string;

  @IsDateString()
  date_from: string;

  // Same as date_from for a single day.
  @IsDateString()
  date_to: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}
