import {
  NotificationType,
  NOTIFICATION_TYPES,
} from '../notification.constants';
import { I18nService } from '../../i18n/i18n.service';

interface NotificationTemplate {
  title: string;
  body: string;
}

export function buildNotificationTemplate(
  type: NotificationType,
  data: Record<string, unknown> = {},
  i18n: I18nService,
  lang: 'ar' | 'en' = 'en',
): NotificationTemplate {
  // Map type constant → locale key
  const typeKeyMap: Record<NotificationType, string> = {
    [NOTIFICATION_TYPES.LOGIN_NEW_DEVICE]: 'login_new_device',
    [NOTIFICATION_TYPES.SESSION_REVOKED]: 'session_revoked',
    [NOTIFICATION_TYPES.TRIAL_ENDING]: 'trial_ending',
    [NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRED]: 'subscription_expired',
    [NOTIFICATION_TYPES.PAYMENT_FAILED]: 'payment_failed',
    [NOTIFICATION_TYPES.PAYMENT_SUCCESS]: 'payment_success',
    [NOTIFICATION_TYPES.EXPENSE_REQUESTED]: 'expense_requested',
    [NOTIFICATION_TYPES.EXPENSE_APPROVED]: 'expense_approved',
    [NOTIFICATION_TYPES.EXPENSE_REJECTED]: 'expense_rejected',
    [NOTIFICATION_TYPES.SHIFT_OPENED]: 'shift_opened',
    [NOTIFICATION_TYPES.SHIFT_CLOSED]: 'shift_closed',
    [NOTIFICATION_TYPES.INVENTORY_STOCK_DEDUCTION_FAILED]:
      'inventory_stock_deduction_failed',
  };

  // Default fallbacks via locale keys
  const defaults: Record<string, unknown> = {
    device_name:
      i18n.t('notifications', 'login_new_device.unknown_device', lang) ||
      'unknown',
    days_remaining: 3,
    amount: '',
    currency: 'SAR',
    cashier_name: 'cashier',
    branch_name: '',
    reason:
      i18n.t('notifications', 'expense_rejected.unspecified', lang) ||
      'unspecified',
    total: '',
  };

  // producers send `total` (sales) or `opening_cash` (shift) - reuse it for {{amount}} so the text is never blank
  const derived: Record<string, unknown> = {};
  if (data.amount === undefined) {
    const v = data.total ?? data.opening_cash;
    if (v !== undefined && v !== null && v !== '') derived.amount = v;
  }
  const mergedData: Record<string, unknown> = { ...defaults, ...derived, ...data };

  const localeKey = typeKeyMap[type];
  if (!localeKey) {
    return i18n.notification('new_notification', {}, lang);
  }

  return i18n.notification(localeKey, mergedData, lang);
}
