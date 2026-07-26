import { IsString, IsNotEmpty } from 'class-validator';

export class RejectAgreementDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}
