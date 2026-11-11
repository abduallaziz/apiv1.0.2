// T11/G8 - every payment method the invoice DTO accepts. 'cash' can never
// be disabled. Keep in sync with CreateInvoiceDto.payment_method and the
// column default in migration 255.
export const ALL_PAYMENT_METHODS = [
  'cash',
  'card',
  'split',
  'wallet',
  'mada',
  'visa',
  'mastercard',
  'stc_pay',
  'apple_pay',
  'tab',
] as const;
