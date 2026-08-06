import { IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean } from 'class-validator';

export class CreateWorkCenterDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsUUID()
  @IsOptional()
  warehouse_id?: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}
