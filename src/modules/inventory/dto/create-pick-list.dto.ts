import {
  IsUUID,
  IsOptional,
  IsArray,
  ArrayMinSize,
  IsIn,
} from 'class-validator';

export class CreatePickListDto {
  @IsUUID()
  warehouse_id: string;

  @IsIn(['single', 'batch', 'wave', 'zone'])
  strategy: 'single' | 'batch' | 'wave' | 'zone';

  @IsUUID()
  @IsOptional()
  zone_location_id?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  shipment_ids: string[];

  // Inventory #7 / 7-2 (Owner-approved) — pick-list operational parity
  // with warehouse_tasks.priority. Defaults to 'medium' server-side
  // (fn_create_pick_list) when omitted.
  @IsIn(['low', 'medium', 'high', 'urgent'])
  @IsOptional()
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}
