import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerFieldDefinitionsRepository } from './customer-field-definitions.repository';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CreateFieldDefinitionDto } from './dto/create-field-definition.dto';
import { UpdateFieldDefinitionDto } from './dto/update-field-definition.dto';

export const BUILTIN_FIELD_KEYS = ['full_name', 'phone'] as const;

const BUILTIN_DEFINITIONS: { field_key: string; label_ar: string; label_en: string; sort_order: number }[] = [
  { field_key: 'full_name', label_ar: 'اسم العميل', label_en: 'Customer Name', sort_order: -2 },
  { field_key: 'phone', label_ar: 'رقم الجوال', label_en: 'Phone', sort_order: -1 },
];

@Injectable()
export class CustomerFieldDefinitionsService {
  constructor(private readonly repo: CustomerFieldDefinitionsRepository) {}

  async findAll(tenant: TenantContext, activeOnly = false) {
    await this.ensureBuiltins(tenant);
    return this.repo.findAll(tenant, activeOnly);
  }

  private async ensureBuiltins(tenant: TenantContext) {
    const existing = await this.repo.findAll(tenant, false);
    const existingKeys = new Set(existing.map((d) => d.field_key));

    for (const builtin of BUILTIN_DEFINITIONS) {
      if (existingKeys.has(builtin.field_key)) continue;
      try {
        await this.repo.create(tenant, {
          field_key: builtin.field_key,
          label_ar: builtin.label_ar,
          label_en: builtin.label_en,
          field_type: 'text',
          required: true,
          sort_order: builtin.sort_order,
        });
      } catch {
        // unique(tenant_id, field_key) race — another request already created it
      }
    }
  }

  async create(tenant: TenantContext, dto: CreateFieldDefinitionDto) {
    const existing = await this.repo.findByKey(tenant, dto.field_key);
    if (existing) throw new BadRequestException('field_key already exists for this tenant');
    if (dto.field_type === 'select' && (!dto.options || dto.options.length === 0)) {
      throw new BadRequestException('options are required for field_type=select');
    }
    return this.repo.create(tenant, dto);
  }

  async update(tenant: TenantContext, id: string, dto: UpdateFieldDefinitionDto) {
    const existing = await this.repo.findById(tenant, id);
    if (!existing) throw new NotFoundException('Field definition not found');

    const isBuiltin = (BUILTIN_FIELD_KEYS as readonly string[]).includes(existing.field_key);
    if (isBuiltin && dto.field_type && dto.field_type !== 'text') {
      throw new BadRequestException('Cannot change field_type of a built-in field');
    }

    return this.repo.update(tenant, id, dto);
  }

  async remove(tenant: TenantContext, id: string) {
    const existing = await this.repo.findById(tenant, id);
    if (!existing) throw new NotFoundException('Field definition not found');

    if ((BUILTIN_FIELD_KEYS as readonly string[]).includes(existing.field_key)) {
      throw new ForbiddenException('Cannot delete a built-in field (full_name/phone) — disable it instead');
    }

    await this.repo.softDelete(tenant, id);
    return { message: 'Field definition deleted' };
  }
}
