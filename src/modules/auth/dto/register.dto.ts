import { IsEmail, IsString, IsBoolean, IsOptional, MinLength, IsIn, Matches } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(2)
  businessName: string;

  @IsString()
  @MinLength(2)
  ownerName: string;

  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/, {
    message: 'phone must be a valid international phone number, e.g. +9665XXXXXXXX',
  })
  phone: string;

  @IsEmail(undefined, { message: 'email must be a valid email address' })
  @Matches(/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/, {
    message: 'email must be a valid email address',
  })
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @MinLength(1)
  activity: string;

  @IsString()
  @MinLength(2)
  branchName: string;

  @IsString()
  @MinLength(2)
  city: string;

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
