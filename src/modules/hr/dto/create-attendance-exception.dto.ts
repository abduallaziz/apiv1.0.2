import { IsUUID, IsDateString, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAttendanceExceptionDto {
  @IsUUID()
  user_id: string;

  @IsDateString()
  date: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}
