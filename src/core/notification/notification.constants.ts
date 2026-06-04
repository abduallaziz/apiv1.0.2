export const NOTIFICATION_QUEUE = 'notifications';

export const NOTIFICATION_CHANNELS = {
  EMAIL: 'email',
  IN_APP: 'in_app',
} as const;

export type NotificationChannel =
  (typeof NOTIFICATION_CHANNELS)[keyof typeof NOTIFICATION_CHANNELS];

export const NOTIFICATION_TYPES = {
  LOGIN_NEW_DEVICE: 'login.new_device',
  SESSION_REVOKED: 'session.revoked',
  TRIAL_ENDING: 'billing.trial_ending',
  SUBSCRIPTION_EXPIRED: 'billing.subscription_expired',
  PAYMENT_FAILED: 'billing.payment_failed',
  PAYMENT_SUCCESS: 'billing.payment_success',
  EXPENSE_REQUESTED: 'expense.requested',
  EXPENSE_APPROVED: 'expense.approved',
  EXPENSE_REJECTED: 'expense.rejected',
  SHIFT_OPENED: 'shift.opened',
  SHIFT_CLOSED: 'shift.closed',
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];