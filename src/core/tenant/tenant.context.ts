export class TenantContext {
  constructor(
    public readonly tenantId: string | null,
    public readonly branchId: string | null = null,
  ) {}
}