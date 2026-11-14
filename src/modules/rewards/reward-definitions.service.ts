import { Injectable, NotFoundException } from '@nestjs/common';
import { RewardDefinitionsRepository } from './reward-definitions.repository';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CreateRewardDefinitionDto } from './dto/create-reward-definition.dto';
import { UpdateRewardDefinitionDto } from './dto/update-reward-definition.dto';
import { validateRewardDefinition } from './reward-definition.validation';

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
    validateRewardDefinition(dto);
    return this.repo.create(tenant, dto);
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateRewardDefinitionDto,
  ) {
    const existing = (await this.findOne(tenant, id)) as {
      trigger_type?: string;
      trigger_config?: Record<string, unknown> | null;
      reward_type?: string;
      reward_config?: Record<string, unknown> | null;
      usage_conditions?: Record<string, unknown> | null;
    };
    // Only re-validate when the semantic config is being changed, so toggling
    // is_active on a legacy row is never blocked.
    if (
      dto.trigger_type !== undefined ||
      dto.trigger_config !== undefined ||
      dto.reward_type !== undefined ||
      dto.reward_config !== undefined ||
      dto.usage_conditions !== undefined
    ) {
      validateRewardDefinition({
        trigger_type: dto.trigger_type ?? existing.trigger_type,
        trigger_config: dto.trigger_config ?? existing.trigger_config,
        reward_type: dto.reward_type ?? existing.reward_type,
        reward_config: dto.reward_config ?? existing.reward_config,
        usage_conditions: dto.usage_conditions ?? existing.usage_conditions,
      });
    }
    return this.repo.update(tenant, id, dto);
  }

  async remove(tenant: TenantContext, id: string) {
    await this.findOne(tenant, id);
    await this.repo.softDelete(tenant, id);
    return { message: 'Reward definition deleted' };
  }
}
