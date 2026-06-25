import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomersRepository } from './customers.repository';
import { CustomerFieldDefinitionsRepository } from './customer-field-definitions.repository';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { TenantsService } from '../tenants/tenants.service';

@Injectable()
export class CustomersService {
  constructor(
    private readonly repo: CustomersRepository,
    private readonly fieldDefinitionsRepo: CustomerFieldDefinitionsRepository,
    private readonly tenantsService: TenantsService,
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

  private async syncContactColumns(
    tenant: TenantContext,
    dto: {
      phone?: string;
      email?: string;
      custom_fields?: Record<string, string | number | boolean | null>;
    },
  ) {
    const customFields = dto.custom_fields ?? {};
    const definitions = await this.fieldDefinitionsRepo.findAll(tenant, true);

    const fieldForRole = (role: string) => definitions.find((d) => d.contact_role === role);

    const toStringValue = (value: unknown) =>
      typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;

    const toIntValue = (value: unknown) => {
      if (typeof value === 'number') return Math.trunc(value);
      if (typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value))) return Math.trunc(Number(value));
      return undefined;
    };

    const phoneField = fieldForRole('phone');
    const emailField = fieldForRole('email');
    const plateField = fieldForRole('plate_number');
    const visitDateField = fieldForRole('visit_date');
    const odometerField = fieldForRole('odometer');

    const phone = dto.phone ?? toStringValue(phoneField ? customFields[phoneField.field_key] : undefined);
    const email = dto.email ?? toStringValue(emailField ? customFields[emailField.field_key] : undefined);
    const plate_number = toStringValue(plateField ? customFields[plateField.field_key] : undefined);
    const visit_date = toStringValue(visitDateField ? customFields[visitDateField.field_key] : undefined);
    const odometer = toIntValue(odometerField ? customFields[odometerField.field_key] : undefined);

    return { phone, email, plate_number, visit_date, odometer };
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
    const { phone, email, plate_number, visit_date, odometer } = await this.syncContactColumns(tenant, dto);

    if (phone) {
      const existing = await this.repo.findByPhone(tenant, phone);
      if (existing) throw new BadRequestException('Phone already registered for this tenant');
    }
    await this.validateCustomFields(tenant, dto.custom_fields, true);

    const posConfig = await this.tenantsService.getPosConfig(tenant.tenantId);

    let full_name = dto.full_name;
    if (posConfig.name_field_enabled) {
      if (!full_name?.trim()) {
        throw new BadRequestException('full_name is required');
      }
    } else {
      const count = await this.repo.countAll(tenant);
      full_name = `عميل ${count + 1}`;
    }

    return this.repo.create(tenant, { ...dto, full_name, phone, email, plate_number, visit_date, odometer });
  }

  async update(tenant: TenantContext, id: string, dto: UpdateCustomerDto) {
    await this.findById(tenant, id);

    const { phone, email, plate_number, visit_date, odometer } = await this.syncContactColumns(tenant, dto);

    if (phone) {
      const existing = await this.repo.findByPhone(tenant, phone);
      if (existing && existing.id !== id) {
        throw new BadRequestException('Phone already registered for this tenant');
      }
    }

    if (dto.custom_fields) {
      await this.validateCustomFields(tenant, dto.custom_fields, false);
    }

    return this.repo.update(tenant, id, { ...dto, phone, email, plate_number, visit_date, odometer });
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
