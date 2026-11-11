import { Injectable, NotFoundException } from '@nestjs/common';
import { RewardDefinitionsRepository } from './reward-definitions.repository';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CreateRewardDefinitionDto } from './dto/create-reward-definition.dto';
import { UpdateRewardDefinitionDto } from './dto/update-reward-definition.dto';

@Injectable()
export class RewardDefinitionsService {
  constructor(private readonly repo: RewardDefinitionsRepository) {}

  findAll(tenant: TenantContext) {
    return this.repo.findAll(tenant);
  }

  async findOne(tenant: TenantContext, id: string) {
    const def = await this.repo.findById(tenant, id);
    if (!def) throw new NotFoundException('Reward definition not found');
    return def;
  }

  create(tenant: TenantContext, dto: CreateRewardDefinitionDto) {
    return this.repo.create(tenant, dto);
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateRewardDefinitionDto,
  ) {
    await this.findOne(tenant, id);
    return this.repo.update(tenant, id, dto);
  }

  async remove(tenant: TenantContext, id: string) {
    await this.findOne(tenant, id);
    await this.repo.softDelete(tenant, id);
    return { message: 'Reward definition deleted' };
  }
}
