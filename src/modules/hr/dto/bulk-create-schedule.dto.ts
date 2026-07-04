import { IsUUID, IsOptional, IsDateString, IsString, IsArray, ArrayMinSize, IsInt, Min, Max, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class DayOverrideDto {
  @IsInt()
  @Min(0)
  @Max(6)
  day: number;

  @IsString()
  @Matches(TIME_PATTERN, { message: 'start_time must be in HH:MM 24h format' })
  start_time: string;

  @IsString()
  @Matches(TIME_PATTERN, { message: 'end_time must be in HH:MM 24h format' })
  end_time: string;
}

export class BulkCreateScheduleDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  user_ids: string[];

  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsDateString()
  date_from: string;

  @IsDateString()
  date_to: string;

  // 0 = Sunday .. 6 = Saturday (JS Date.getDay() convention). Only dates whose weekday is
  // in this list get a schedule row. Empty/omitted = every day in the range.
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days_of_week?: number[];

  @IsString()
  @Matches(TIME_PATTERN, { message: 'start_time must be in HH:MM 24h format' })
  start_time: string;

  @IsString()
  @Matches(TIME_PATTERN, { message: 'end_time must be in HH:MM 24h format' })
  end_time: string;

  // Per-weekday time overrides — e.g. every selected day uses start_time/end_time above,
  // except Friday which uses its own hours here instead.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DayOverrideDto)
  day_overrides?: DayOverrideDto[];
}
