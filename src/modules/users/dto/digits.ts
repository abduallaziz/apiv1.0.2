import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';

const AR = '٠١٢٣٤٥٦٧٨٩';
const FA = '۰۱۲۳۴۵۶۷۸۹';

/** Arabic-Indic / Persian digits -> 0-9. */
export function toWesternDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (c) => {
    const i = AR.indexOf(c);
    return String(i >= 0 ? i : FA.indexOf(c));
  });
}

/** Trim + normalize digits; spaces/dashes inside phones are dropped. */
export function normalizePhone(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return toWesternDigits(value).trim().replace(/[\s-]/g, '');
}

export const NormalizePhone = () =>
  Transform(({ value }) => normalizePhone(value));
export const NormalizeDigits = () =>
  Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? toWesternDigits(value).trim() : value,
  );

export const IsPhoneNumber7to20 = () =>
  Matches(/^\+?\d{7,20}$/, {
    message: 'phone must be a valid phone number (7-20 digits)',
  });
export const IsIdentityDigits = () =>
  Matches(/^\d{4,20}$/, {
    message: 'identity_number must contain digits only (4-20)',
  });
