import { IsString, IsNotEmpty } from 'class-validator';

export class RecordShortPickDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}
