import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomersRepository } from './customers.repository';
import { CustomerFieldDefinitionsRepository } from './customer-field-definitions.repository';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly repo: CustomersRepository,
    private readonly fieldDefinitionsRepo: CustomerFieldDefinitionsRepository,
  ) {}

  private async validateCustomFields(
    tenant: TenantContext,
    customFields: Record<string, unknown> | undefined,
    isCreate: boolean,
  ) {
    const definitions = await this.fieldDefinitionsRepo.findAll(tenant, true);
    const byKey = new Map(definitions.map((d) => [d.field_key, d]));

    for (const key of Object.keys(customFields ?? {})) {
      if (!byKey.has(key)) {
        throw new BadRequestException(`Unknown custom field: ${key}`);
      }
    }

    for (const def of definitions) {
      const value = customFields?.[def.field_key];

      if (isCreate && def.required && (value === undefined || value === null || value === '')) {
        throw new BadRequestException(`Custom field "${def.field_key}" is required`);
      }

      if (value === undefined || value === null) continue;

      if (def.field_type === 'number' && typeof value !== 'number') {
        throw new BadRequestException(`Custom field "${def.field_key}" must be a number`);
      }
      if (def.field_type === 'boolean' && typeof value !== 'boolean') {
        throw new BadRequestException(`Custom field "${def.field_key}" must be a boolean`);
      }
      if (def.field_type === 'select') {
        const allowed = (def.options ?? []).map((o: { value: string }) => o.value);
        if (!allowed.includes(value as string)) {
          throw new BadRequestException(`Custom field "${def.field_key}" has an invalid option`);
        }
      }
    }
  }

  async getStats(tenant: TenantContext) {
    return this.repo.getGlobalStats(tenant);
  }

  async findAll(tenant: TenantContext, query: CustomerQueryDto) {
    let customFieldKeys: string[] = [];
    if (query.search) {
      const definitions = await this.fieldDefinitionsRepo.findAll(tenant, true);
      customFieldKeys = definitions
        .filter((d) => d.field_type === 'text' || d.field_type === 'select')
        .map((d) => d.field_key);
    }
    return this.repo.findAll(tenant, query.search, query.page, query.limit, customFieldKeys);
  }

  async findById(tenant: TenantContext, id: string) {
    const customer = await this.repo.findById(tenant, id);
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async create(tenant: TenantContext, dto: CreateCustomerDto) {
    if (dto.phone) {
      const existing = await this.repo.findByPhone(tenant, dto.phone);
      if (existing) throw new BadRequestException('Phone already registered for this tenant');
    }
    await this.validateCustomFields(tenant, dto.custom_fields, true);

    let full_name = dto.full_name;
    if (!full_name) {
      const count = await this.repo.countAll(tenant);
      full_name = `عميل ${count + 1}`;
    }

    return this.repo.create(tenant, { ...dto, full_name });
  }

  async update(tenant: TenantContext, id: string, dto: UpdateCustomerDto) {
    await this.findById(tenant, id);

    if (dto.phone) {
      const existing = await this.repo.findByPhone(tenant, dto.phone);
      if (existing && existing.id !== id) {
        throw new BadRequestException('Phone already registered for this tenant');
      }
    }

    if (dto.custom_fields) {
      await this.validateCustomFields(tenant, dto.custom_fields, false);
    }

    return this.repo.update(tenant, id, dto);
  }

  async remove(tenant: TenantContext, id: string) {
    await this.findById(tenant, id);
    await this.repo.softDelete(tenant, id);
    return { message: 'Customer deleted' };
  }

  async getHistory(tenant: TenantContext, id: string) {
    const customer = await this.findById(tenant, id);
    const [stats, recent_orders] = await Promise.all([
      this.repo.getStats(tenant, id),
      this.repo.getHistory(tenant, id),
    ]);
    return { customer, stats, recent_orders };
  }
}
