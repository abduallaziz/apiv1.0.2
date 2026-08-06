import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateOperationDto {
  @IsInt()
  @Min(1)
  sequence: number;

  @IsString()
  @IsNotEmpty()
  operation_name: string;

  @IsUUID()
  @IsOptional()
  work_center_id?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  duration_minutes?: number;
}
