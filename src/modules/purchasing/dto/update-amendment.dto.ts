import { IsString, IsOptional, IsDateString } from 'class-validator';

export class UpdateAmendmentDto {
  @IsDateString()
  @IsOptional()
  new_expiration_date?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
