import { IsString, IsOptional, MaxLength } from 'class-validator';

export class CreateBranchDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;
}