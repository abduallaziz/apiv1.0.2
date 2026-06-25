import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerFieldDefinitionsRepository } from './customer-field-definitions.repository';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CreateFieldDefinitionDto } from './dto/create-field-definition.dto';
import { UpdateFieldDefinitionDto } from './dto/update-field-definition.dto';

@Injectable()
export class CustomerFieldDefinitionsService {
  constructor(private readonly repo: CustomerFieldDefinitionsRepository) {}

  findAll(tenant: TenantContext, activeOnly = false) {
    return this.repo.findAll(tenant, activeOnly);
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
    return this.repo.update(tenant, id, dto);
  }

  async remove(tenant: TenantContext, id: string) {
    const existing = await this.repo.findById(tenant, id);
    if (!existing) throw new NotFoundException('Field definition not found');
    await this.repo.softDelete(tenant, id);
    return { message: 'Field definition deleted' };
  }
}
