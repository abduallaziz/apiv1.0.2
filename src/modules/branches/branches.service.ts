import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { BranchesRepository } from './branches.repository';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { BillingService } from '../../core/billing/billing.service';

@Injectable()
export class BranchesService {
  constructor(
    private readonly repo: BranchesRepository,
    private readonly billingService: BillingService,
  ) {}

  async findAll(tenant: TenantContext) {
    return this.repo.findAll(tenant);
  }

  async findById(id: string, tenant: TenantContext) {
    const branch = await this.repo.findById(id, tenant);
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  async create(dto: CreateBranchDto, tenant: TenantContext) {
    await this.billingService.checkBranchLimit(tenant.tenantId);
    return this.repo.create(tenant, dto);
  }

  async update(id: string, dto: UpdateBranchDto, tenant: TenantContext) {
    const branch = await this.repo.findById(id, tenant);
    if (!branch) throw new NotFoundException('Branch not found');
    return this.repo.update(id, tenant, dto);
  }

  async remove(id: string, tenant: TenantContext) {
    const branch = await this.repo.findById(id, tenant);
    if (!branch) throw new NotFoundException('Branch not found');

    const count = await this.repo.countActive(tenant);
    if (count <= 1) {
      throw new BadRequestException('Cannot delete the last active branch.');
    }

    await this.repo.softDelete(id, tenant);
    return { success: true };
  }
}