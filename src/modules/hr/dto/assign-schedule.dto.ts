import { IsUUID, IsOptional, IsArray, ArrayMinSize, IsInt, Min, Max, IsDateString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { DayOverrideDto } from './bulk-create-schedule.dto';
import { ShiftDto } from './shift.dto';

export class CustomScheduleDto {
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days_of_week: number[];

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

// Either shift_pattern_id (assign a shared, reusable pattern) or custom (a
// one-off schedule for just these employees) must be provided — validated in
// the service, not here, since it's a mutual-exclusivity rule across two
// optional fields rather than a per-field shape rule.
export class AssignScheduleDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  user_ids: string[];

  @IsOptional()
  @IsUUID()
  shift_pattern_id?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CustomScheduleDto)
  custom?: CustomScheduleDto;

  // When the employee starts working this pattern. No end date by design —
  // employment is treated as indefinite until explicitly reassigned/removed.
  @IsDateString()
  schedule_start_date: string;
}
