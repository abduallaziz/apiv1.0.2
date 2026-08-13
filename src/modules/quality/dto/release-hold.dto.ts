import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class ReleaseHoldDto {
  @IsBoolean()
  approved: boolean;

  @IsString()
  @IsOptional()
  reason?: string;

  // Required when approved=false (reject path) — the held quantity does
  // NOT return to availability; disposition records what happens to it.
  @IsIn(['accept', 'reject', 'scrap', 'rework', 'return_supplier', 'use_as_is'])
  @IsOptional()
  disposition?:
    | 'accept'
    | 'reject'
    | 'scrap'
    | 'rework'
    | 'return_supplier'
    | 'use_as_is';
}
