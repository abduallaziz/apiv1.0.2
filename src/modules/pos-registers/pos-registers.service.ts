import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PosRegistersRepository } from './pos-registers.repository';
import { BillingService } from '../../core/billing/billing.service';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CreatePosRegisterDto } from './dto/create-pos-register.dto';
import { UpdatePosRegisterDto } from './dto/update-pos-register.dto';

const NAME_TAKEN = 'A register with this name already exists in this branch';

function isNameClash(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return err?.code === '23505' && String(err?.message).includes('pos_registers_name');
}

@Injectable()
export class PosRegistersService {
  constructor(
    private readonly repo: PosRegistersRepository,
    private readonly billing: BillingService,
  ) {}

  listByBranch(tenant: TenantContext, branchId: string) {
    return this.repo.listByBranch(tenant, branchId);
  }

  async create(dto: CreatePosRegisterDto, tenant: TenantContext) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('name should not be empty');
    // A restricted (branch) user can only add to their own branch.
    if (tenant.isolated && tenant.branchId && dto.branch_id !== tenant.branchId) {
      throw new BadRequestException('You can only add a register to your working branch');
    }
    // Pool check across all branches (plan max_pos + extra_pos add-ons).
    await this.billing.checkPosLimit(tenant.tenantId);
    try {
      return await this.repo.create(tenant, {
        branch_id: dto.branch_id,
        name,
        sort_order: dto.sort_order,
      });
    } catch (e) {
      if (isNameClash(e)) throw new ConflictException(NAME_TAKEN);
      throw e;
    }
  }

  async update(id: string, dto: UpdatePosRegisterDto, tenant: TenantContext) {
    const existing = await this.repo.findById(tenant, id);
    if (!existing) throw new NotFoundException('Register not found');

    const patch: { name?: string; is_active?: boolean; sort_order?: number } = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('name should not be empty');
      patch.name = name;
    }
    if (dto.sort_order !== undefined) patch.sort_order = dto.sort_order;
    if (dto.is_active !== undefined) {
      // Deactivating a register that still has an open shift would strand that shift.
      if (!dto.is_active && (await this.repo.hasOpenShift(tenant.tenantId, id))) {
        throw new ConflictException('Close the open shift before deactivating this register');
      }
      patch.is_active = dto.is_active;
    }

    try {
      return await this.repo.update(tenant, id, patch);
    } catch (e) {
      if (isNameClash(e)) throw new ConflictException(NAME_TAKEN);
      throw e;
    }
  }

  async remove(id: string, tenant: TenantContext) {
    const existing = await this.repo.findById(tenant, id);
    if (!existing) throw new NotFoundException('Register not found');
    if (await this.repo.hasOpenShift(tenant.tenantId, id)) {
      throw new ConflictException('Close the open shift before deleting this register');
    }
    await this.repo.softDelete(tenant, id);
    return { success: true };
  }

  /**
   * Resolves the register a shift opens on: the one the cashier chose, or — when none was given — the
   * branch's single active register (keeps single-drawer shops working without a picker). Ambiguous when
   * the branch has several registers and none was chosen.
   */
  async resolveForOpen(
    tenant: TenantContext,
    branchId: string,
    registerId?: string | null,
  ): Promise<string> {
    const regs = await this.repo.listByBranch(tenant, branchId);
    const active = regs.filter((r) => (r as { is_active: boolean }).is_active);
    if (registerId) {
      const hit = active.find((r) => (r as { id: string }).id === registerId);
      if (!hit) throw new BadRequestException('The chosen register is not available in this branch');
      return registerId;
    }
    if (active.length === 1) return (active[0] as { id: string }).id;
    if (active.length === 0) {
      throw new BadRequestException('This branch has no active POS register');
    }
    throw new BadRequestException('Choose a POS register to open the shift on');
  }
}
