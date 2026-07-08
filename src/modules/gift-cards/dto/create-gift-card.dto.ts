import { IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';

export class CreateGiftCardDto {
  @IsOptional()
  @IsString()
  @MinLength(4)
  code?: string;

  @IsNumber()
  @Min(0.01)
  initial_balance: number;

  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @IsOptional()
  @IsISO8601()
  expires_at?: string;
}
