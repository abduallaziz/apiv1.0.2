import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { toEnglishDigits } from '../../customers/customer-normalize';

export const WEEKDAYS = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
] as const;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** '' / whitespace -> null (clears the field); other values trimmed. */
const emptyToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || null : value;

const digitsOnly = ({ value }: { value: unknown }): unknown => {
  const v = emptyToNull({ value });
  return typeof v === 'string' ? toEnglishDigits(v).replace(/\s/g, '') : v;
};

const shortCode = ({ value }: { value: unknown }): unknown => {
  const v = emptyToNull({ value });
  return typeof v === 'string' ? toEnglishDigits(v).toUpperCase() : v;
};

/** Returns an error message, or null when `value` is a valid working-hours object. */
export function checkWorkingHours(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'working_hours must be an object keyed by weekday';
  }
  for (const [day, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!(WEEKDAYS as readonly string[]).includes(day)) {
      return `working_hours has an unknown day "${day}"`;
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return `working_hours.${day} must be an object`;
    }
    const d = raw as Record<string, unknown>;
    if (typeof d.closed !== 'boolean') {
      return `working_hours.${day}.closed must be a boolean`;
    }
    if (!d.closed) {
      if (
        typeof d.open !== 'string' ||
        typeof d.close !== 'string' ||
        !TIME_RE.test(d.open) ||
        !TIME_RE.test(d.close)
      ) {
        return `working_hours.${day} open/close must be HH:mm`;
      }
    }
  }
  return null;
}

function IsWorkingHours(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isWorkingHours',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (v: unknown) => checkWorkingHours(v) === null,
        defaultMessage: (args) =>
          checkWorkingHours(args?.value) ?? 'working_hours is invalid',
      },
    });
}

/** Profile fields shared by the create (wizard) and update DTOs. All optional; null clears on update. */
export class BranchProfileDto {
  @IsOptional()
  @Transform(shortCode)
  @Matches(/^[A-Z0-9]{2,6}$/, {
    message: 'short_code must be 2-6 letters or digits (A-Z, 0-9)',
  })
  short_code?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(100)
  city?: string | null;

  /** Format is checked by the service with the customers phone helper (7-20 digits). */
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(20, {
    message: 'phone must be a valid phone number (7-20 digits)',
  })
  phone?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsEmail()
  @MaxLength(120)
  email?: string | null;

  @IsOptional()
  @Transform(digitsOnly)
  @Matches(/^\d{15}$/, { message: 'tax_number must be exactly 15 digits' })
  tax_number?: string | null;

  @IsOptional()
  @Transform(digitsOnly)
  @Matches(/^\d{4,20}$/, {
    message: 'commercial_registration must be 4-20 digits',
  })
  commercial_registration?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  invoice_footer?: string | null;

  @IsOptional()
  @IsIn(['58mm', '80mm'])
  printer_size?: '58mm' | '80mm' | null;

  @IsOptional()
  @IsObject()
  @IsWorkingHours()
  working_hours?: Record<
    string,
    { open?: string; close?: string; closed: boolean }
  > | null;
}
