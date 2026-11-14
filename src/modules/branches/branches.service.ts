import {
  Injectable,
  Logger,
  Optional,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { TenantIsolationService } from '../../core/security/tenant-isolation.service';
import { BranchesRepository } from './branches.repository';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { BranchPublishService } from './publish/branch-publish.service';
import { checkContactValues } from '../customers/customer-normalize';
import { BillingService } from '../../core/billing/billing.service';

const SHORT_CODE_TAKEN = 'A branch with this short code already exists';

function isShortCodeClash(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return err?.code === '23505' && String(err.message).includes('short_code');
}

@Injectable()
export class BranchesService {
  constructor(
    private readonly repo: BranchesRepository,
    private readonly billingService: BillingService,
    private readonly isolation: TenantIsolationService,
    @Optional() private readonly publisher?: BranchPublishService,
  ) {}

  private readonly logger = new Logger(BranchesService.name);

  async findAll(tenant: TenantContext, activeOnly = false) {
    return this.repo.findAll(tenant, activeOnly);
  }

  async findById(id: string, tenant: TenantContext) {
    const branch = await this.repo.findById(id, tenant);
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  async create(
    dto: CreateBranchDto,
    tenant: TenantContext,
    userId: string | null = null,
    central = true,
  ) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('name should not be empty');
    if (await this.repo.nameExists(tenant, name)) {
      throw new ConflictException('A branch with this name already exists');
    }
    const {
      copy_setup_from_main: copySetup,
      warehouse_name: warehouseName,
      wizard_copy: wizardCopy,
      ...rest
    } = dto;
    const profile = await this.validateProfile(tenant, rest);
    const actor = { userId, central };
    // Validate the wizard copy BEFORE creating anything (central + isolation + source branch).
    if (wizardCopy) {
      if (!this.publisher) {
        throw new BadRequestException('Copying from a branch is unavailable');
      }
      await this.publisher.assertCanCopyFromBranch(tenant, wizardCopy, actor);
    }
    await this.billingService.checkBranchLimit(tenant.tenantId);
    const branch = await this.createRow(
      tenant,
      { ...rest, ...profile, name },
      warehouseName,
    );
    await this.provisionAccounting(tenant.tenantId, branch.id as string, name);
    if (wizardCopy && this.publisher) {
      const wizard_copy = await this.publisher.copyFromBranch(
        tenant,
        wizardCopy,
        branch.id as string,
        actor,
      );
      return { ...branch, wizard_copy };
    }
    if (copySetup && tenant.isolated && tenant.tenantId && this.publisher) {
      try {
        const iso = await this.repo.getIsolation(tenant.tenantId);
        if (iso.main_branch_id && iso.main_branch_id !== branch.id) {
          const setup_copy = await this.publisher.copySetupFromMain(
            tenant.tenantId,
            iso.main_branch_id,
            branch.id as string,
            userId,
          );
          return { ...branch, setup_copy };
        }
      } catch (e) {
        // The branch exists already: a failed convenience copy must not fail its creation.
        this.logger.warn(
          `copy setup from main failed: ${(e as Error).message}`,
        );
      }
    }
    return branch;
  }

  /** Insert; a unique-index race on short_code surfaces as the same 409 as the pre-check. */
  private async createRow(
    tenant: TenantContext,
    data: Parameters<BranchesRepository['create']>[1],
    warehouseName?: string,
  ) {
    try {
      return await this.repo.create(tenant, data, warehouseName);
    } catch (e) {
      if (isShortCodeClash(e)) throw new ConflictException(SHORT_CODE_TAKEN);
      throw e;
    }
  }

  /**
   * Normalises + validates the wizard profile fields (phone format via the customers helper, short code
   * uniqueness per tenant, case-insensitive). Returns the normalised values to store.
   */
  private async validateProfile(
    tenant: TenantContext,
    dto: { phone?: string | null; short_code?: string | null },
    excludeId?: string,
  ): Promise<{ phone?: string | null }> {
    const out: { phone?: string | null } = {};
    if (dto.phone !== undefined) {
      if (dto.phone === null) out.phone = null;
      else {
        const checked = checkContactValues({ phone: dto.phone });
        if (checked.error) throw new BadRequestException(checked.error);
        out.phone = checked.phone ?? null;
      }
    }
    if (
      dto.short_code &&
      (await this.repo.shortCodeExists(tenant, dto.short_code, excludeId))
    ) {
      throw new ConflictException(SHORT_CODE_TAKEN);
    }
    return out;
  }

  /**
   * Every branch needs an accounting owner or its sales cannot be posted ("No Accounting Owner is assigned to
   * branch"). Best effort and idempotent: a failure is logged and never blocks the caller.
   */
  private async provisionAccounting(
    tenantId: string,
    branchId: string,
    name: string,
  ): Promise<void> {
    try {
      await this.repo.ensureAccountingOwner(tenantId, branchId, name);
    } catch (e) {
      this.logger.warn(
        `accounting owner setup failed for branch ${branchId}: ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }

  async update(id: string, dto: UpdateBranchDto, tenant: TenantContext) {
    const branch = await this.repo.findById(id, tenant);
    if (!branch) throw new NotFoundException('Branch not found');

    if (dto.name !== undefined) {
      dto.name = dto.name.trim();
      if (!dto.name) throw new BadRequestException('name should not be empty');
      if (await this.repo.nameExists(tenant, dto.name, id)) {
        throw new ConflictException('A branch with this name already exists');
      }
    }

    if (dto.default_warehouse_id) {
      const belongsToTenant = await this.repo.warehouseBelongsToTenant(
        dto.default_warehouse_id,
        tenant.tenantId,
      );
      if (!belongsToTenant) {
        throw new BadRequestException('Warehouse not found');
      }
    }

    const profile = await this.validateProfile(tenant, dto, id);
    let updated;
    try {
      updated = await this.repo.update(id, tenant, { ...dto, ...profile });
    } catch (e) {
      if (isShortCodeClash(e)) throw new ConflictException(SHORT_CODE_TAKEN);
      throw e;
    }
    if (dto.name && dto.name !== branch.name) {
      await this.repo.renameAutoWarehouse(
        tenant,
        branch.default_warehouse_id as string | null,
        branch.name as string,
        dto.name,
      );
    }
    return updated;
  }

  async remove(id: string, tenant: TenantContext) {
    const branch = await this.repo.findById(id, tenant);
    if (!branch) throw new NotFoundException('Branch not found');

    const count = await this.repo.countActive(tenant);
    if (count <= 1) {
      throw new BadRequestException('Cannot delete the last active branch.');
    }

    if (await this.repo.hasOpenShift(id, tenant)) {
      throw new ConflictException(
        'Cannot delete a branch that has an open shift.',
      );
    }
    if (await this.repo.hasHistory(id, tenant)) {
      throw new ConflictException(
        'Cannot delete a branch that has shifts or invoices. Deactivate it instead.',
      );
    }

    const warehouseId = branch.default_warehouse_id as string | null;
    await this.repo.softDelete(id, tenant);
    // The auto-created warehouse goes with the branch, unless it holds stock.
    if (
      warehouseId &&
      !(await this.repo.warehouseHasStock(warehouseId, tenant))
    ) {
      await this.repo.softDeleteWarehouse(warehouseId, tenant);
    }
    return { success: true };
  }

  // ── Branch isolation ────────────────────────────────────────────────────────────────────
  getIsolation(tenant: TenantContext) {
    return this.repo.getIsolation(tenant.tenantId);
  }

  /** Turns full branch isolation on/off for the tenant. Needs a main branch to resolve the default scope. */
  async setIsolation(tenant: TenantContext, enabled: boolean) {
    const current = await this.repo.getIsolation(tenant.tenantId);
    if (enabled && !current.main_branch_id) {
      throw new BadRequestException(
        'Set a main branch before enabling branch isolation',
      );
    }
    // Everything that has no branch yet joins the main branch BEFORE the flag flips, so nothing
    // disappears from view the moment isolation starts.
    if (enabled) {
      try {
        await this.repo.backfillHr(tenant.tenantId);
        await this.repo.backfillToMain(tenant.tenantId);
      } catch (e) {
        // A duplicate key between unbranched rows and the main branch's rows (migration 292): readable 409.
        const err = e as { code?: string; message?: string };
        if (err?.code === '23505') {
          throw new ConflictException(
            err.message ?? 'A duplicate key prevents enabling branch isolation',
          );
        }
        throw e;
      }
    }
    // Independent branches must each be able to post their sales: give every active branch an accounting owner.
    if (enabled) {
      for (const b of await this.repo.activeBranchIdsAndNames(
        tenant.tenantId,
      )) {
        await this.provisionAccounting(tenant.tenantId, b.id, b.name);
      }
    }
    await this.repo.setIsolation(tenant.tenantId, enabled);
    this.isolation.invalidate(tenant.tenantId);
    return this.repo.getIsolation(tenant.tenantId);
  }

  async setMain(id: string, tenant: TenantContext) {
    const branch = await this.repo.findById(id, tenant);
    if (!branch) throw new NotFoundException('Branch not found');
    if (!branch.is_active) {
      throw new BadRequestException('The main branch must be active');
    }
    await this.repo.setMainBranch(tenant.tenantId, id);
    this.isolation.invalidate(tenant.tenantId);
    return this.repo.findById(id, tenant);
  }
}
