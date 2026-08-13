import { IsUUID, IsString, IsNotEmpty, IsOptional, IsDateString } from 'class-validator';

export class CreateDeviationDto {
  @IsUUID()
  item_id: string;

  @IsUUID()
  @IsOptional()
  non_conformance_id?: string;

  @IsUUID()
  @IsOptional()
  quality_inspection_id?: string;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsDateString()
  @IsOptional()
  expires_at?: string;
}
