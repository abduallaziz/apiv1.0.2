import { IsOptional, IsIn } from 'class-validator';

// Inventory #7 / 7-6 (Owner-approved) — priority applies to the single
// pick_lists row the release produces (matches CreatePickListDto's/
// CreateZoneSplitPickListsDto's existing priority contract).
export class ReleaseWaveDto {
  @IsIn(['low', 'medium', 'high', 'urgent'])
  @IsOptional()
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}
