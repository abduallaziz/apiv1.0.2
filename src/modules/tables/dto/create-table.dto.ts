import {
  IsUUID,
  IsString,
  IsInt,
  Min,
  Max,
  MaxLength,
  IsOptional,
} from 'class-validator';

export class CreateTableDto {
  @IsUUID()
  branch_id: string;

  @IsString()
  @MaxLength(50, { message: 'Table name must be at most 50 characters' })
  name: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number;
}
