import { IsString, IsNotEmpty } from 'class-validator';

export class VerifyCorrectiveActionDto {
  @IsString()
  @IsNotEmpty()
  effectiveness_check: string;
}
