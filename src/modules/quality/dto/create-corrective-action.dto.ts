import { IsUUID, IsString, IsNotEmpty, IsOptional, IsIn, IsDateString } from 'class-validator';

export class CreateCorrectiveActionDto {
  @IsUUID()
  non_conformance_id: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  owner_id: string;

  @IsIn(['low', 'medium', 'high', 'critical'])
  @IsOptional()
  priority?: string;

  @IsDateString()
  @IsOptional()
  due_date?: string;
}
