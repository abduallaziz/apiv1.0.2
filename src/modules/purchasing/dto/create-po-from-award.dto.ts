import { IsUUID, IsString, IsNotEmpty } from 'class-validator';

export class CreatePoFromAwardDto {
  @IsUUID()
  warehouse_id: string;

  @IsString()
  @IsNotEmpty()
  order_number_prefix: string;
}
