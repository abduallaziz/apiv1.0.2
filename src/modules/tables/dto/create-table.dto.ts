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
  @MaxLength(50)
  name: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number;
}
