import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomersRepository } from './customers.repository';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly repo: CustomersRepository) {}

  async getStats(tenant: TenantContext) {
    return this.repo.getGlobalStats(tenant);
  }

  async findAll(tenant: TenantContext, query: CustomerQueryDto) {
    return this.repo.findAll(tenant, query.search, query.page, query.limit);
  }

  async findById(tenant: TenantContext, id: string) {
    const customer = await this.repo.findById(tenant, id);
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async create(tenant: TenantContext, dto: CreateCustomerDto) {
    const existing = await this.repo.findByPhone(tenant, dto.phone);
    if (existing) throw new BadRequestException('Phone already registered for this tenant');
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