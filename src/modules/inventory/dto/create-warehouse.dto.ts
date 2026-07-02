import { IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean } from 'class-validator';

export class CreateWarehouseDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsUUID()
  @IsOptional()
  branch_id?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}
