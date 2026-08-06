import { IsDateString, IsOptional, IsBoolean } from 'class-validator';

export class GenerateSnapshotDto {
  @IsDateString()
  @IsOptional()
  snapshot_date?: string;

  @IsBoolean()
  @IsOptional()
  supersede?: boolean;
}
