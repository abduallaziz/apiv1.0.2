import { IsISO8601, IsOptional, IsString, IsUUID } from 'class-validator';

// Accounting Backend Phase 1 — POST /accounting/branch-assignments. The
// only write in this module. Maps directly onto branch_accounting_
// assignments' existing columns (migration 178) — the INSERT itself is
// still guarded by fn_guard_branch_accounting_assignment_mutation,
// unchanged.
export class AssignBranchAccountingOwnerDto {
  @IsUUID()
  branch_id: string;

  @IsUUID()
  accounting_owner_id: string;

  @IsISO8601()
  effective_from: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
