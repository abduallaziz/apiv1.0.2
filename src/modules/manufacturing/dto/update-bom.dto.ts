import { IsString, IsOptional } from 'class-validator';

// Only metadata is editable in place — item_id/variant_id define the BOM's
// identity (see uq_bom_active_per_item) and lines are replaced wholesale via
// ReplaceBomLinesDto, not patched here.
export class UpdateBomDto {
  @IsString()
  @IsOptional()
  notes?: string;
}
