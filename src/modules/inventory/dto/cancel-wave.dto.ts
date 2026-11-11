import { IsString, IsNotEmpty } from 'class-validator';

export class CancelWaveDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}
