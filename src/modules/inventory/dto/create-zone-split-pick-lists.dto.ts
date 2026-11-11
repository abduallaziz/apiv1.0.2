import {
  IsUUID,
  IsArray,
  ArrayMinSize,
  IsOptional,
  IsIn,
} from 'class-validator';

// Inventory #7 / 7-3 (Owner-approved) — automatic multi-zone splitting
// (§5.1: never reject a multi-zone shipment set, never lose lines). No
// zone_location_id/strategy here — the backend discovers every zone
// actually represented among the given shipments' lines and creates one
// 'zone' pick list per zone automatically.
export class CreateZoneSplitPickListsDto {
  @IsUUID()
  warehouse_id: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  shipment_ids: string[];

  @IsIn(['low', 'medium', 'high', 'urgent'])
  @IsOptional()
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}
