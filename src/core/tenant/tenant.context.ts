export class TenantContext {
  constructor(
    public readonly tenantId: string | null,
    public readonly branchId: string | null = null,
    /**
     * True when the tenant runs with branch isolation (tenants.branch_isolation_enabled): then
     * `branchId` is ALWAYS set (the requested/own branch, or the main branch for a central user)
     * and repositories must scope their queries to it.
     */
    public readonly isolated: boolean = false,
  ) {}
}
