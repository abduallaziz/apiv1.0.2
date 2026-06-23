import { IsEmail, IsString, IsBoolean, IsOptional, MinLength, IsIn } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(2)
  businessName: string;

  @IsString()
  @MinLength(2)
  ownerName: string;

  @IsString()
  @MinLength(7)
  phone: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  activity: string;

  @IsOptional()
  @IsString()
  branchName?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsIn(['SAR', 'AED', 'KWD', 'BHD', 'QAR', 'OMR'])
  currency?: string;

  @IsOptional()
  @IsBoolean()
  vatEnabled?: boolean;

  @IsOptional()
  @IsIn(['ar', 'en'])
  language?: string;

  @IsOptional()
  @IsString()
  device_name?: string;
}
