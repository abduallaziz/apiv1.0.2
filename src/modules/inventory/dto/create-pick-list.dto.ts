import { IsUUID, IsOptional, IsArray, ArrayMinSize, IsIn } from 'class-validator';

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
}
