import { IsUUID, IsOptional, IsDateString, IsArray, ArrayMinSize, IsInt, Min, Max, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ShiftDto } from './shift.dto';

export class DayOverrideDto {
  @IsInt()
  @Min(0)
  @Max(6)
  day: number;

  // Replaces the base `shifts` array entirely for this weekday — e.g. every
  // selected day works two shifts except Friday, which overrides to one.
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShiftDto)
  shifts: ShiftDto[];
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

  // One or more shift segments applied to every matching date (e.g. a split
  // shift: 08:00-12:00 and 14:00-00:00) unless overridden for that weekday.
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShiftDto)
  shifts: ShiftDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DayOverrideDto)
  day_overrides?: DayOverrideDto[];
}
