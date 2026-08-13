import { IsString, IsNotEmpty, IsOptional, IsUUID, IsIn, IsNumber, Min, Max } from 'class-validator';

export class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsUUID()
  template_id: string;

  @IsIn(['every_transaction', 'sampling'])
  @IsOptional()
  frequency?: 'every_transaction' | 'sampling';

  @IsNumber()
  @Min(0.01)
  @Max(100)
  @IsOptional()
  sample_size_percent?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  acceptance_defect_count?: number;

  @IsString()
  @IsOptional()
  responsible_role?: string;
}
