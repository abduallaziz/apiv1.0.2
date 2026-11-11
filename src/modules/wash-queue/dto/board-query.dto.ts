import { IsOptional, IsUUID, Matches } from 'class-validator';

export class WashBoardQueryDto {
  @IsUUID()
  branch_id: string;

  // YYYY-MM-DD (UTC queue day); defaults to today.
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}
