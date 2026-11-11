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
