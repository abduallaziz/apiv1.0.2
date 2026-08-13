import { IsUUID, IsNumber, Min } from 'class-validator';

export class ConfirmWarehouseTaskDto {
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @IsUUID()
  confirmed_location_id: string;
}
