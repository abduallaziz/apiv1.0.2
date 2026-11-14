import { IsOptional, IsString, IsUUID, IsIn } from 'class-validator';

export class QueryExpensesDto {
  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected', 'expired', 'cancelled'])
  status?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}
