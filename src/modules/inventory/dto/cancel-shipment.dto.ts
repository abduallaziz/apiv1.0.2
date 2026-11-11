import { IsString, IsNotEmpty } from 'class-validator';

// Inventory #7 / 7-7 (Owner-approved) — reconciled to the same reason
// contract CancelPickListDto/CancelWaveDto already use.
export class CancelShipmentDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}
