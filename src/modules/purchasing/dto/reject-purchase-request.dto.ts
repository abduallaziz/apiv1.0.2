import { IsString, IsNotEmpty } from 'class-validator';

export class RejectPurchaseRequestDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}
