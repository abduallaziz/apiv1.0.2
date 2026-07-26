import { IsString, IsNotEmpty } from 'class-validator';

export class RejectReleaseDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}
