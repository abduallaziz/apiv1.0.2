import { IsString, IsOptional } from 'class-validator';

export class CloseCorrectiveActionDto {
  @IsString()
  @IsOptional()
  closure_notes?: string;
}
