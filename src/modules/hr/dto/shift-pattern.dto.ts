import { IsString, IsOptional, IsArray, IsInt, Min, Max, Matches, ValidateNested, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { DayOverrideDto } from './bulk-create-schedule.dto';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class CreateShiftPatternDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days_of_week: number[];

  @IsString()
  @Matches(TIME_PATTERN, { message: 'start_time must be in HH:MM 24h format' })
  start_time: string;

  @IsString()
  @Matches(TIME_PATTERN, { message: 'end_time must be in HH:MM 24h format' })
  end_time: string;

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
  @IsString()
  @Matches(TIME_PATTERN, { message: 'start_time must be in HH:MM 24h format' })
  start_time?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN, { message: 'end_time must be in HH:MM 24h format' })
  end_time?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DayOverrideDto)
  day_overrides?: DayOverrideDto[];
}
