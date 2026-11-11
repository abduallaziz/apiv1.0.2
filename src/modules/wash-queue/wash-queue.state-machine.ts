// Pure mirror of the transition rules enforced in the database function
// fn_wash_job_transition (migration 256). The database stays the authority;
// this copy lets the service fail fast with the right error and is what the
// unit tests exercise.
export const WASH_STATUSES = [
  'waiting',
  'washing',
  'ready',
  'delivered',
  'cancelled',
] as const;
export type WashStatus = (typeof WASH_STATUSES)[number];

const FORWARD: Record<WashStatus, WashStatus[]> = {
  waiting: ['washing', 'cancelled'],
  washing: ['ready', 'cancelled'],
  ready: ['delivered'],
  delivered: [],
  cancelled: [],
};

// Roles allowed to send a ready car back to washing (re-wash).
export const REWASH_ROLES = ['superadmin', 'owner', 'manager'];

export function isRewash(from: WashStatus, to: WashStatus): boolean {
  return from === 'ready' && to === 'washing';
}

export function canTransition(
  from: WashStatus,
  to: WashStatus,
  allowRewash = false,
): boolean {
  if (FORWARD[from].includes(to)) return true;
  return isRewash(from, to) && allowRewash;
}

export function canRewash(role: string | undefined): boolean {
  return !!role && REWASH_ROLES.includes(role);
}
