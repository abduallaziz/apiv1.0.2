import { IsString, Matches } from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

// One shift segment within a day. end_time may be <= start_time to represent
// a shift crossing midnight (e.g. 14:00-00:00) — validated as a time-of-day
// format only, not compared against start_time here.
export class ShiftDto {
  @IsString()
  @Matches(TIME_PATTERN, { message: 'start_time must be in HH:MM 24h format' })
  start_time: string;

  @IsString()
  @Matches(TIME_PATTERN, { message: 'end_time must be in HH:MM 24h format' })
  end_time: string;
}
