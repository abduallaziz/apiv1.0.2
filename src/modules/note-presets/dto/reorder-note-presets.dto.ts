import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class ReorderNotePresetsDto {
  // Full ordered list of this tenant's preset ids — the array index becomes each
  // preset's new sort_order. The service verifies every id actually belongs to the
  // requesting tenant before writing anything.
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  ids: string[];
}
