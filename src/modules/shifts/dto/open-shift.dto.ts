import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class OpenShiftDto {
  @IsUUID()
  branch_id: string;

  // The POS register (صندوق) to open on. Optional: a single-register branch resolves automatically;
  // a branch with several registers must choose one.
  @IsUUID()
  @IsOptional()
  register_id?: string;

  @IsNumber()
  @Min(0)
  opening_cash: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
