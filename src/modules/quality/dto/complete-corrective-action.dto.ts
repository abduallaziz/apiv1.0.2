import { IsIn, IsOptional, IsString } from 'class-validator';

export class CompleteCorrectiveActionDto {
  @IsString()
  @IsOptional()
  notes?: string;

  @IsIn(['accept', 'reject', 'scrap', 'rework', 'return_supplier', 'use_as_is'])
  @IsOptional()
  disposition?: string;
}
