import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ReleaseHoldDto {
  @IsBoolean()
  approved: boolean;

  @IsString()
  @IsOptional()
  reason?: string;
}
