import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsBoolean,
  MaxLength,
} from 'class-validator';

export class CreateBranchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  /** Branch isolation only: copy the main branch's setup (categories, expense lookups, shift patterns...) to the new branch. */
  @IsOptional()
  @IsBoolean()
  copy_setup_from_main?: boolean;
}
