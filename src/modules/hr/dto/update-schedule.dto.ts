import { IsUUID, IsOptional, IsDateString, IsString, Matches, MaxLength } from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class UpdateScheduleDto {
  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @IsDateString()
  scheduled_date?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN, { message: 'start_time must be in HH:MM 24h format' })
  start_time?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN, { message: 'end_time must be in HH:MM 24h format' })
  end_time?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
