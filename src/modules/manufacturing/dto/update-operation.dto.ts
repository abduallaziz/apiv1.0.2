import { IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export enum OperationStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
}

export class UpdateOperationDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  sequence?: number;

  @IsString()
  @IsOptional()
  operation_name?: string;

  @IsUUID()
  @IsOptional()
  work_center_id?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  duration_minutes?: number;

  @IsEnum(OperationStatus)
  @IsOptional()
  status?: OperationStatus;
}
