import { IsString, IsOptional, IsArray, ArrayMinSize, IsInt, Min, Max, ValidateNested, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { DayOverrideDto } from './bulk-create-schedule.dto';
import { ShiftDto } from './shift.dto';

export class CreateShiftPatternDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days_of_week: number[];

  // One or more shift segments per matching day — a single entry is a
  // regular shift (e.g. 09:00-17:00); two entries is a split shift (e.g.
  // 08:00-12:00 + 14:00-00:00).
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

export class UpdateShiftPatternDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days_of_week?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShiftDto)
  shifts?: ShiftDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DayOverrideDto)
  day_overrides?: DayOverrideDto[];
}
