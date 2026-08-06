import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ApproveStockCountDto {
  @IsBoolean()
  approved: boolean;

  @IsString()
  @IsOptional()
  reason?: string;
}
