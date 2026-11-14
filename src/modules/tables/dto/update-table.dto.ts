import {
  IsString,
  IsInt,
  Min,
  Max,
  MaxLength,
  IsOptional,
  IsIn,
} from 'class-validator';

export class UpdateTableDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number;

  @IsOptional()
  @IsIn(['available', 'occupied', 'reserved', 'cleaning'])
  status?: 'available' | 'occupied' | 'reserved' | 'cleaning';
}
