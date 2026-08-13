import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class DecideDeviationDto {
  @IsBoolean()
  approved: boolean;

  @IsString()
  @IsOptional()
  decision_notes?: string;
}
