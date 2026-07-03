import { IsUUID, IsString, IsInt, Min, MaxLength, IsOptional } from 'class-validator';

export class CreateTableDto {
  @IsUUID()
  branch_id: string;

  @IsString()
  @MaxLength(50)
  name: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}
