import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateDeviceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['active', 'inactive', 'disabled'])
  status?: 'active' | 'inactive' | 'disabled';

  @IsOptional()
  @IsUUID()
  assigned_to?: string | null;

  @IsOptional()
  @IsUUID()
  assigned_warehouse_id?: string | null;
}
