export const QUEUE_NAMES = {
  DUNNING: 'dunning',
  AUDIT_CLEANUP: 'audit-cleanup',
  NOTIFICATIONS: 'notifications',
  DOMAIN_EVENTS: 'domain-events',
  AI: 'ai',
  ANALYTICS: 'analytics',
} as const;

/** Max concurrent AI jobs processed at the same time. */
export const AI_QUEUE_CONCURRENCY = 3;

/** BullMQ priority values — lower number = higher priority. */
export const AI_PRIORITY = {
  HIGH: 1,
  NORMAL: 2,
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
