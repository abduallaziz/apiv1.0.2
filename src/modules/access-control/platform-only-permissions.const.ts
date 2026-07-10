// Single source of truth, imported by both the repository (what tenant
// admins ever see in the catalog) and the service (what they're allowed to
// write) — see STATUS.md §83. Splitting this into two independent copies is
// exactly how the original privilege-escalation gap happened: the write-side
// got a stopgap block, the read-side didn't, so the permission stayed
// visible and toggleable in the UI right up until it 403'd with no
// explanation. Stopgap, not the durable fix — see the comment at the call
// sites for why (a schema-level `is_platform_only` flag on `permissions` is
// the real fix, this hardcoded list doesn't generalize to future additions).
export const HARDCODED_PLATFORM_ONLY_KEYS = new Set([
  'analytics.view.all',
  'audit.view.all',
]);
