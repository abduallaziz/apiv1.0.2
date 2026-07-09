import { IsString, IsOptional, MinLength, MaxLength, IsEnum, IsIn, IsBoolean, IsNumber, Min, Max, IsUrl, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BusinessType } from '../../../shared/types/enums';

export class PrinterSettingsDto {
  @IsOptional()
  @IsIn(['58mm', '80mm'])
  paper_width?: '58mm' | '80mm';

  @IsOptional()
  @IsBoolean()
  auto_print?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  printer_name?: string;
}

// Only covers notification types that are actually ever sent over email (dunning/billing flow).
// expense.*/shift.* types are in-app only today — no toggle exposed for them yet (would be a no-op).
export class NotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  subscription_expired?: boolean;

  @IsOptional()
  @IsBoolean()
  payment_failed?: boolean;

  @IsOptional()
  @IsBoolean()
  payment_success?: boolean;
}

export class UpdateTenantProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEnum(BusinessType)
  business_type?: BusinessType;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency_symbol?: string;

  @IsOptional()
  @IsBoolean()
  customer_capture_enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  name_field_enabled?: boolean;

  // Stored as a fraction (0–1), e.g. 0.15 for 15%. The frontend sends value/100.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  tax_rate?: number;

  @IsOptional()
  @IsUrl()
  logo_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tax_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  invoice_footer?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PrinterSettingsDto)
  printer_settings?: PrinterSettingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationPreferencesDto)
  notification_preferences?: NotificationPreferencesDto;

  // Points earned per 1 currency unit spent (e.g. 1 = 1 point per SAR spent).
  @IsOptional()
  @IsNumber()
  @Min(0)
  loyalty_points_per_currency?: number;

  // Currency value of a single redeemed point (e.g. 0.01 = 100 points worth 1 SAR).
  @IsOptional()
  @IsNumber()
  @Min(0)
  loyalty_redemption_value?: number;

  // Master switch for the whole loyalty program (points/tiers/redemption). Defaults
  // to true at the DB level so no existing tenant's behavior changes silently.
  @IsOptional()
  @IsBoolean()
  loyalty_enabled?: boolean;
}