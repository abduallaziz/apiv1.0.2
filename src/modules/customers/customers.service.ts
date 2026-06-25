import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomersRepository } from './customers.repository';
import { CustomerFieldDefinitionsRepository } from './customer-field-definitions.repository';
import { BUILTIN_FIELD_KEYS, CustomerFieldDefinitionsService } from './customer-field-definitions.service';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';

const BUILTIN_KEY_SET = new Set<string>(BUILTIN_FIELD_KEYS);

@Injectable()
export class CustomersService {
  constructor(
    private readonly repo: CustomersRepository,
    private readonly fieldDefinitionsRepo: CustomerFieldDefinitionsRepository,
    private readonly fieldDefinitionsService: CustomerFieldDefinitionsService,
  ) {}

  /**
   * full_name/phone are owner-configurable like any other field — required-ness
   * comes entirely from customer_field_definitions, not from hardcoded DTO rules.
   */
  private async validateFields(
    tenant: TenantContext,
    dto: CreateCustomerDto | UpdateCustomerDto,
    isCreate: boolean,
  ) {
    // ensures full_name/phone definitions exist for this tenant
    await this.fieldDefinitionsService.findAll(tenant, true);
    const definitions = await this.fieldDefinitionsRepo.findAll(tenant, true);
    const customFields = dto.custom_fields;

    for (const key of Object.keys(customFields ?? {})) {
      if (BUILTIN_KEY_SET.has(key)) continue;
      if (!definitions.some((d) => d.field_key === key)) {
        throw new BadRequestException(`Unknown custom field: ${key}`);
      }
    }

    for (const def of definitions) {
      const value = BUILTIN_KEY_SET.has(def.field_key)
        ? (dto as Record<string, unknown>)[def.field_key]
        : customFields?.[def.field_key];

      if (isCreate && def.required && (value === undefined || value === null || value === '')) {
        throw new BadRequestException(`Custom field "${def.field_key}" is required`);
      }

      if (BUILTIN_KEY_SET.has(def.field_key)) continue; // type already enforced by DTO validators
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
        .filter((d) => !BUILTIN_KEY_SET.has(d.field_key) && (d.field_type === 'text' || d.field_type === 'select'))
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
    await this.validateFields(tenant, dto, true);
    return this.repo.create(tenant, dto);
  }

  async update(tenant: TenantContext, id: string, dto: UpdateCustomerDto) {
    await this.findById(tenant, id);

    if (dto.phone) {
      const existing = await this.repo.findByPhone(tenant, dto.phone);
      if (existing && existing.id !== id) {
        throw new BadRequestException('Phone already registered for this tenant');
      }
    }

    await this.validateFields(tenant, dto, false);

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