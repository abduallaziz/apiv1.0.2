import { IsString, IsNotEmpty } from 'class-validator';

export class RejectRfqDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}
