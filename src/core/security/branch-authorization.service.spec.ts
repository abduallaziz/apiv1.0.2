import { BranchAuthorizationService } from './branch-authorization.service';
import { BranchValidatorService } from './branch-validator.service';
import { BranchAuthorizationActor } from './branch-authorization.types';

// Branch System Step 4 (Owner-approved) — unit tests for the one reusable
// branch-authorization decision point. BranchValidatorService is stubbed,
// not the real Supabase-backed instance: this service's own logic (the
// actor-vs-branch comparison) is what's under test here, not Supabase
// query behavior, which BranchValidatorService already owns and is
// exercised elsewhere. A stub also lets "branch not found / inactive /
// deleted / cross-tenant" all be simulated identically, since from this
// service's point of view they are indistinguishable — BranchValidatorService
// throws for all of them alike.

const TENANT_A = 'tenant-a';
const BRANCH_A1 = 'branch-a1';
const BRANCH_A2 = 'branch-a2';

function centralActor(): BranchAuthorizationActor {
  return { tenantId: TENANT_A, userId: 'user-central', branchId: null };
}

function restrictedActor(branchId: string): BranchAuthorizationActor {
  return { tenantId: TENANT_A, userId: 'user-restricted', branchId };
}

function buildService(
  validateImpl: (branchId: string, tenantId: string) => Promise<void>,
) {
  const validateMock = jest.fn(validateImpl);
  const validator = {
    validate: validateMock,
  } as unknown as BranchValidatorService;
  return { service: new BranchAuthorizationService(validator), validateMock };
}

const alwaysValid = () => Promise.resolve();
const alwaysInvalid = () =>
  Promise.reject(new Error('Branch not found or does not belong to tenant'));

describe('BranchAuthorizationService', () => {
  describe('resolveBranchScope', () => {
    it('1. Central + no branch requested → allowed, tenant-wide scope', async () => {
      const { service, validateMock } = buildService(alwaysValid);
      const result = await service.resolveBranchScope(
        centralActor(),
        undefined,
        'read',
      );
      expect(result).toEqual({ allowed: true, effectiveBranchId: null });
      expect(validateMock).not.toHaveBeenCalled();
    });

    it('2. Central + own-tenant branch requested → allowed, scoped to that branch', async () => {
      const { service } = buildService(alwaysValid);
      const result = await service.resolveBranchScope(
        centralActor(),
        BRANCH_A1,
        'read',
      );
      expect(result).toEqual({ allowed: true, effectiveBranchId: BRANCH_A1 });
    });

    it('3. Central + cross-tenant branch requested → rejected', async () => {
      const { service } = buildService(alwaysInvalid);
      const result = await service.resolveBranchScope(
        centralActor(),
        'branch-of-other-tenant',
        'read',
      );
      expect(result).toEqual({ allowed: false, reason: 'branch_not_found' });
    });

    it('4. Restricted + own branch requested → allowed, scoped to own branch', async () => {
      const { service } = buildService(alwaysValid);
      const result = await service.resolveBranchScope(
        restrictedActor(BRANCH_A1),
        BRANCH_A1,
        'read',
      );
      expect(result).toEqual({ allowed: true, effectiveBranchId: BRANCH_A1 });
    });

    it('5. Restricted + other branch requested → rejected (never auto-corrected)', async () => {
      const { service, validateMock } = buildService(alwaysValid);
      const result = await service.resolveBranchScope(
        restrictedActor(BRANCH_A1),
        BRANCH_A2,
        'read',
      );
      expect(result).toEqual({ allowed: false, reason: 'branch_mismatch' });
      // Rejected before ever asking whether BRANCH_A2 itself is valid —
      // the mismatch alone is sufficient to deny.
      expect(validateMock).not.toHaveBeenCalled();
    });

    it('6. Restricted + omitted branch → effective scope forced to own branch, never tenant-wide', async () => {
      const { service } = buildService(alwaysValid);
      const result = await service.resolveBranchScope(
        restrictedActor(BRANCH_A1),
        undefined,
        'read',
      );
      expect(result).toEqual({ allowed: true, effectiveBranchId: BRANCH_A1 });
    });

    it('6b. Restricted + null (vs undefined) requested branch is treated identically to omitted', async () => {
      const { service } = buildService(alwaysValid);
      const result = await service.resolveBranchScope(
        restrictedActor(BRANCH_A1),
        null,
        'read',
      );
      expect(result).toEqual({ allowed: true, effectiveBranchId: BRANCH_A1 });
    });

    it('7. Inactive branch (Central, requested) → rejected', async () => {
      const { service } = buildService(alwaysInvalid);
      const result = await service.resolveBranchScope(
        centralActor(),
        BRANCH_A1,
        'read',
      );
      expect(result).toEqual({ allowed: false, reason: 'branch_not_found' });
    });

    it('8. Deleted branch (Restricted, own branch was soft-deleted since token issued) → rejected', async () => {
      const { service } = buildService(alwaysInvalid);
      const result = await service.resolveBranchScope(
        restrictedActor(BRANCH_A1),
        undefined,
        'read',
      );
      expect(result).toEqual({ allowed: false, reason: 'branch_not_found' });
    });

    it('9. Write mismatch (Restricted actor creating for another branch) → rejected identically to read', async () => {
      const { service } = buildService(alwaysValid);
      const result = await service.resolveBranchScope(
        restrictedActor(BRANCH_A1),
        BRANCH_A2,
        'write',
      );
      expect(result).toEqual({ allowed: false, reason: 'branch_mismatch' });
    });

    it('12. Central actor with explicit null branchId is treated as Central, not an invalid state', async () => {
      const actor: BranchAuthorizationActor = {
        tenantId: TENANT_A,
        userId: 'u',
        branchId: null,
      };
      const { service } = buildService(alwaysValid);
      const result = await service.resolveBranchScope(actor, undefined, 'read');
      expect(result.allowed).toBe(true);
    });
  });

  describe('authorizeRecordAccess', () => {
    it('10. Restricted actor, record belongs to a different branch → rejected', async () => {
      const { service } = buildService(alwaysValid);
      const result = await service.authorizeRecordAccess(
        restrictedActor(BRANCH_A1),
        BRANCH_A2,
      );
      expect(result).toEqual({ allowed: false, reason: 'branch_mismatch' });
    });

    it('10b. Restricted actor, record belongs to their own branch → allowed', async () => {
      const { service } = buildService(alwaysValid);
      const result = await service.authorizeRecordAccess(
        restrictedActor(BRANCH_A1),
        BRANCH_A1,
      );
      expect(result).toEqual({ allowed: true, effectiveBranchId: BRANCH_A1 });
    });

    it('11. Detail-by-id: unauthorized cross-branch record is a plain denial the caller must map to 404', async () => {
      const { service } = buildService(alwaysValid);
      const result = await service.authorizeRecordAccess(
        restrictedActor(BRANCH_A1),
        BRANCH_A2,
      );
      expect(result.allowed).toBe(false);
      // The service itself never throws/returns an HTTP status — this just
      // documents the contract callers rely on: a denial here is what a
      // detail-by-id handler translates to 404 (not 403), to avoid
      // confirming the record's existence to an unauthorized caller.
      expect(result).toEqual({ allowed: false, reason: 'branch_mismatch' });
    });

    it('Central actor, any record branch → always allowed (tenant membership already checked upstream)', async () => {
      const { service } = buildService(alwaysValid);
      const result = await service.authorizeRecordAccess(
        centralActor(),
        BRANCH_A2,
      );
      expect(result).toEqual({ allowed: true, effectiveBranchId: BRANCH_A2 });
    });

    it('Restricted actor, tenant-wide/legacy record (null branch) → allowed, nothing to restrict against', async () => {
      const { service } = buildService(alwaysValid);
      const result = await service.authorizeRecordAccess(
        restrictedActor(BRANCH_A1),
        null,
      );
      expect(result).toEqual({ allowed: true, effectiveBranchId: null });
    });
  });
});
