import { IsString, IsOptional, IsBoolean, IsUUID, MaxLength } from 'class-validator';

export class UpdateBranchDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  // Which warehouse POS sales at this branch deduct inventory from. null clears it
  // (branch reverts to not deducting inventory on sale — see migration 043).
  @IsOptional()
  @IsUUID()
  default_warehouse_id?: string | null;
}