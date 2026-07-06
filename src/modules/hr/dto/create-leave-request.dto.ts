import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateLeaveRequestDto {
  @IsIn(['annual', 'sick', 'unpaid', 'other'])
  leave_type: string;

  @IsISO8601({ strict: true })
  date_from: string;

  @IsISO8601({ strict: true })
  date_to: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
