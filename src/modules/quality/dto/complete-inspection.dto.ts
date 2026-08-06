import { IsIn, IsOptional, IsString } from 'class-validator';

export class CompleteInspectionDto {
  @IsIn(['passed', 'failed', 'conditional'])
  status: 'passed' | 'failed' | 'conditional';

  @IsString()
  @IsOptional()
  notes?: string;
}
