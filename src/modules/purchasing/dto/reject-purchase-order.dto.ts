import { IsString, IsNotEmpty } from 'class-validator';

export class RejectPurchaseOrderDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}
