import { IsUUID, IsString, IsInt, Min, MaxLength, IsOptional } from 'class-validator';

export class CreateWaitlistEntryDto {
  @IsUUID()
  branch_id: string;

  @IsString()
  @MaxLength(100)
  customer_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  customer_phone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  party_size?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  quoted_wait_minutes?: number;
}
