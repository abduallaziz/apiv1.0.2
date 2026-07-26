import { IsString, IsOptional } from 'class-validator';

export class UpdateReleaseDto {
  @IsString()
  @IsOptional()
  notes?: string;
}
