// T12 — TypeScript mirror of fn_normalize_phone / fn_normalize_plate
// (migration 255). The two MUST stay identical: the DB unique indexes are
// built on the SQL versions, the API matches with these.

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXT_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

export function toEnglishDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(EXT_ARABIC_INDIC.indexOf(d)));
}

/** Digits only, last 9 digits (covers 05…, 5…, +9665…, 009665…). */
export function normalizePhone(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const digits = toEnglishDigits(value).replace(/[^0-9]/g, '');
  const last = digits.slice(-9);
  return last === '' ? null : last;
}

/** No spaces/dashes/underscores/dots, upper-case, English digits. */
export function normalizePlate(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const cleaned = toEnglishDigits(value)
    .replace(/[\s\-_.]/g, '')
    .toUpperCase();
  return cleaned === '' ? null : cleaned;
}

export const PHONE_MAX_LENGTH = 20;
export const PLATE_MAX_LENGTH = 20;

/**
 * Escapes a user-typed search term for use inside an ILIKE pattern, so `%`
 * and `_` match literally instead of acting as wildcards. Commas are dropped
 * because they delimit PostgREST `.or()` conditions. Backslash is Postgres'
 * default LIKE escape character.
 */
export function escapeLikeTerm(value: string): string {
  return value.replace(/,/g, '').replace(/[\\%_]/g, '\\$&');
}

/**
 * Validates + normalises the contact values of a customer write. Returns the
 * phone with English digits (or an error message in the API's English
 * vocabulary, translated by the web client). Arabic-Indic digits are accepted
 * and converted; letters are rejected.
 */
export function checkContactValues(input: {
  phone?: string | null;
  plate?: string | null;
}): { phone?: string; error?: string } {
  let phone: string | undefined;
  if (input.phone != null && String(input.phone).trim() !== '') {
    const converted = toEnglishDigits(String(input.phone)).trim();
    const digits = converted.replace(/\D/g, '');
    if (
      !/^\+?[\d\s-]+$/.test(converted) ||
      digits.length < 7 ||
      digits.length > PHONE_MAX_LENGTH ||
      converted.length > PHONE_MAX_LENGTH
    ) {
      return { error: 'phone must be a valid phone number (7-20 digits)' };
    }
    phone = converted;
  }
  if (
    input.plate != null &&
    String(input.plate).trim().length > PLATE_MAX_LENGTH
  ) {
    return { error: 'plate must be at most 20 characters' };
  }
  return { phone };
}
