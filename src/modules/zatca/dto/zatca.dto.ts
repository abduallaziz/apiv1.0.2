import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class SellerDto {
  @IsString() @MinLength(2) @MaxLength(200)
  legal_name: string;

  // 15 digits, starts and ends with 3
  @Matches(/^3\d{13}3$/, { message: 'vat_number must be 15 digits starting and ending with 3' })
  vat_number: string;

  @IsOptional() @IsString() @MaxLength(20)
  crn?: string;

  @IsString() @MinLength(2) @MaxLength(100)
  street: string;

  @Matches(/^\d{4}$/, { message: 'building_no must be 4 digits' })
  building_no: string;

  @IsOptional() @Matches(/^\d{4}$/, { message: 'plot_id must be 4 digits' })
  plot_id?: string;

  @IsString() @MinLength(2) @MaxLength(100)
  district: string;

  @IsString() @MinLength(2) @MaxLength(100)
  city: string;

  @Matches(/^\d{5}$/, { message: 'postal_zone must be 5 digits' })
  postal_zone: string;
}

export class CreateZatcaDeviceDto {
  @IsUUID('4')
  branch_id: string;

  @IsOptional() @IsIn(['sandbox', 'simulation', 'production'])
  env?: 'sandbox' | 'simulation' | 'production';

  /** Name of this EGS unit (becomes the CSR common name). */
  @IsString() @MinLength(2) @MaxLength(100)
  egs_name: string;

  /** e.g. "Restaurants", "Retail" — the CSR businessCategory. */
  @IsString() @MinLength(2) @MaxLength(100)
  business_category: string;

  @ValidateNested() @Type(() => SellerDto)
  seller: SellerDto;
}

export class AttachCertificateDto {
  @IsString() @Matches(/BEGIN CERTIFICATE/, { message: 'certificate_pem must be a PEM certificate' })
  certificate_pem: string;

  @IsIn(['compliance', 'production'])
  kind: 'compliance' | 'production';

  /** The secret issued with the CSID (stored encrypted). */
  @IsOptional() @IsString() @MaxLength(500)
  secret?: string;
}
