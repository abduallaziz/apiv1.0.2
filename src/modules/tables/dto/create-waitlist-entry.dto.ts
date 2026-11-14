import {
  IsUUID,
  IsString,
  IsInt,
  Min,
  Max,
  MaxLength,
  IsOptional,
} from 'class-validator';

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
  @Max(1000)
  party_size?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  quoted_wait_minutes?: number;
}
