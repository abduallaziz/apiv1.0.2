export const QUEUE_NAMES = {
  DUNNING: 'dunning',
  AUDIT_CLEANUP: 'audit-cleanup',
  NOTIFICATIONS: 'notifications',
  DOMAIN_EVENTS: 'domain-events',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
