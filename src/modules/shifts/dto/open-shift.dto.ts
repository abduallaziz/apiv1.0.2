import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class OpenShiftDto {
  @IsUUID()
  branch_id: string;

  @IsNumber()
  @Min(0)
  opening_cash: number;

  @IsString()
  @IsOptional()
  notes?: string;
}