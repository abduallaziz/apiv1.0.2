// Internal QA/demo tenant exemptions (RBAC bypass + rate-limit exemption).
//
// Both exemptions are honoured ONLY outside production. Under
// NODE_ENV=production a QA tenant id gets no special treatment: it goes
// through the normal PermissionGuard / throttlers like any other tenant.
// Callers must pass a tenant id taken from a VERIFIED token (never from
// jwt.decode alone).
const QA_TENANT_IDS: readonly string[] = [
  '9bcd3369-d664-47c8-b297-3bc9b429aacf',
];

export function isQaExemptionAllowedHere(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export function isQaTenant(tenantId: string | null | undefined): boolean {
  return (
    !!tenantId && isQaExemptionAllowedHere() && QA_TENANT_IDS.includes(tenantId)
  );
}
