import { IsString, IsInt, Min, MaxLength, IsOptional, IsIn } from 'class-validator';

export class UpdateTableDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsIn(['available', 'occupied', 'reserved', 'cleaning'])
  status?: 'available' | 'occupied' | 'reserved' | 'cleaning';
}
