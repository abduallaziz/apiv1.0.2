import { IsString, IsOptional } from 'class-validator';

export class ShipShipmentDto {
  @IsString()
  @IsOptional()
  tracking_number?: string;
}
