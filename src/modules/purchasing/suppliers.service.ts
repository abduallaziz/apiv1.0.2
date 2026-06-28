import { Injectable, NotFoundException } from '@nestjs/common';
import { SuppliersRepository } from './repositories/suppliers.repository';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private readonly suppliersRepo: SuppliersRepository) {}

  findAll(tenantId: string) {
    return this.suppliersRepo.findAll(tenantId);
  }

  async findById(id: string, tenantId: string) {
    const supplier = await this.suppliersRepo.findById(id, tenantId);
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  create(tenantId: string, dto: CreateSupplierDto) {
    return this.suppliersRepo.create(tenantId, { ...dto });
  }

  async update(id: string, tenantId: string, dto: UpdateSupplierDto) {
    await this.findById(id, tenantId);
    return this.suppliersRepo.update(id, tenantId, { ...dto });
  }

  async remove(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    await this.suppliersRepo.softDelete(id, tenantId);
  }
}
