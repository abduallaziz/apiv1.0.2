import {
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

// Optional date range for GET /customers/stats (bare local calendar days, same
// convention as the reports endpoints). Without it only the all-time and
// this-month figures are returned.
export class CustomerStatsQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export class CustomerLookupQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  plate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

export class CreateVehicleDto {
  @IsString()
  @MaxLength(30)
  plate: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  size?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  colour?: string;
}

export class UpdateVehicleDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  plate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  size?: string;
}

// Sent with an invoice: resolved server-side when the sale is confirmed.
export class CustomerCaptureDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  plate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  size?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsObject()
  custom_fields?: Record<string, string | number | boolean | null>;
}
