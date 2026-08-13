import { Injectable, NotFoundException } from '@nestjs/common';
import { QualityConfigRepository } from './repositories/quality-config.repository';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { CreatePlanDto } from './dto/create-plan.dto';
import { CreateRuleDto } from './dto/create-rule.dto';

@Injectable()
export class QualityConfigService {
  constructor(private readonly configRepo: QualityConfigRepository) {}

  findAllTemplates(tenantId: string) {
    return this.configRepo.findAllTemplates(tenantId);
  }

  async findTemplateById(id: string, tenantId: string) {
    const template = await this.configRepo.findTemplateById(id, tenantId);
    if (!template) throw new NotFoundException('Quality template not found');
    return template;
  }

  createTemplate(tenantId: string, dto: CreateTemplateDto) {
    return this.configRepo.createTemplate(tenantId, dto.name, dto.notes ?? null, dto.checks as unknown as Record<string, unknown>[]);
  }

  async updateTemplate(id: string, tenantId: string, dto: UpdateTemplateDto) {
    await this.findTemplateById(id, tenantId);
    return this.configRepo.updateTemplate(id, tenantId, { ...dto });
  }

  findAllPlans(tenantId: string) {
    return this.configRepo.findAllPlans(tenantId);
  }

  createPlan(tenantId: string, dto: CreatePlanDto) {
    return this.configRepo.createPlan(tenantId, {
      name: dto.name,
      template_id: dto.template_id,
      frequency: dto.frequency ?? 'every_transaction',
      sample_size_percent: dto.sample_size_percent ?? null,
      acceptance_defect_count: dto.acceptance_defect_count ?? null,
      responsible_role: dto.responsible_role ?? null,
    });
  }

  findAllRules(tenantId: string) {
    return this.configRepo.findAllRules(tenantId);
  }

  createRule(tenantId: string, dto: CreateRuleDto) {
    return this.configRepo.createRule(tenantId, {
      name: dto.name,
      applies_to_item_id: dto.applies_to_item_id ?? null,
      applies_to_category_id: dto.applies_to_category_id ?? null,
      applies_to_supplier_id: dto.applies_to_supplier_id ?? null,
      applies_to_warehouse_id: dto.applies_to_warehouse_id ?? null,
      transaction_type: dto.transaction_type ?? null,
      action: dto.action,
      template_id: dto.template_id ?? null,
      sample_size_percent: dto.sample_size_percent ?? null,
      acceptance_defect_count: dto.acceptance_defect_count ?? null,
    });
  }

  // Called by GoodsReceiptsService / ProductionOrdersService / CountsService
  // integration points to resolve whether a quality action is required.
  resolvePlan(
    tenantId: string,
    transactionType: 'goods_receipt' | 'production_output' | 'stock_count',
    itemId: string,
    categoryId: string | null,
    supplierId: string | null,
    warehouseId: string | null,
  ) {
    return this.configRepo.resolvePlan(tenantId, transactionType, itemId, categoryId, supplierId, warehouseId);
  }
}
