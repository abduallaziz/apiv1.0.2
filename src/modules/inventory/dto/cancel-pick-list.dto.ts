import { IsString, IsNotEmpty } from 'class-validator';

export class CancelPickListDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}
