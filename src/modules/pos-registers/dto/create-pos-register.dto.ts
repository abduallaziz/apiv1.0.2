import { IsUUID, IsString, IsOptional, IsInt, Min, MaxLength } from 'class-validator';

export class CreatePosRegisterDto {
  @IsUUID()
  branch_id: string;

  @IsString()
  @MaxLength(60)
  name: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;
}
