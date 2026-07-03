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

// Maps a notification type to its key in tenants.notification_preferences.
// Only covers types that are ever actually sent over email (billing/dunning flow) —
// expense.*/shift.* are in-app only today, so there's no email toggle to offer for them yet.
// Security-critical types (login/session) are intentionally excluded — always sent, not user-toggleable.
export const NOTIFICATION_PREFERENCE_KEYS: Partial<Record<NotificationType, string>> = {
  [NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRED]: 'subscription_expired',
  [NOTIFICATION_TYPES.PAYMENT_FAILED]: 'payment_failed',
  [NOTIFICATION_TYPES.PAYMENT_SUCCESS]: 'payment_success',
};