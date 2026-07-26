import { IsString, IsNotEmpty } from 'class-validator';

export class RejectAmendmentDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}
