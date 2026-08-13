import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OwnershipRepository } from './repositories/ownership.repository';
import { WarehousesService } from '../inventory/warehouses.service';
import { ItemsService } from '../items/items.service';
import { CreateOwnershipLayerDto } from './dto/create-ownership-layer.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { ReleaseOwnershipDto } from './dto/release-ownership.dto';

@Injectable()
export class OwnershipService {
  constructor(
    private readonly ownershipRepo: OwnershipRepository,
    private readonly warehousesService: WarehousesService,
    private readonly itemsService: ItemsService,
  ) {}

  findAll(
    tenantId: string,
    filters: {
      status?: string;
      warehouse_id?: string;
      item_id?: string;
      ownership_type?: string;
    },
  ) {
    return this.ownershipRepo.findAll(tenantId, filters);
  }

  async findById(id: string, tenantId: string) {
    const layer = await this.ownershipRepo.findById(id, tenantId);
    if (!layer) throw new NotFoundException('Ownership layer not found');
    return layer;
  }

  async create(
    tenantId: string,
    dto: CreateOwnershipLayerDto,
    createdBy: string,
  ) {
    await this.warehousesService.findById(dto.warehouse_id, tenantId); // throws NotFoundException if missing
    await this.itemsService.findById(dto.item_id, tenantId); // throws NotFoundException if missing

    if (dto.ownership_type === 'consignment' && !dto.owner_supplier_id) {
      throw new BadRequestException(
        'owner_supplier_id is required for consignment ownership',
      );
    }
    if (dto.ownership_type === 'customer' && !dto.owner_customer_id) {
      throw new BadRequestException(
        'owner_customer_id is required for customer ownership',
      );
    }

    return this.ownershipRepo.create(tenantId, {
      warehouse_id: dto.warehouse_id,
      item_id: dto.item_id,
      variant_id: dto.variant_id ?? null,
      ownership_type: dto.ownership_type,
      owner_customer_id: dto.owner_customer_id ?? null,
      owner_supplier_id: dto.owner_supplier_id ?? null,
      quantity: dto.quantity,
      reason: dto.reason ?? null,
      created_by: createdBy,
    });
  }

  async transfer(id: string, tenantId: string, dto: TransferOwnershipDto) {
    await this.findById(id, tenantId); // 404 if missing
    const transferred = await this.ownershipRepo.transfer(id, tenantId, {
      ownership_type: dto.ownership_type,
      owner_customer_id: dto.owner_customer_id ?? null,
      owner_supplier_id: dto.owner_supplier_id ?? null,
      reason: dto.reason ?? null,
      created_by: null,
    });
    if (!transferred) {
      throw new BadRequestException(`Ownership layer ${id} is not active`);
    }
    return transferred;
  }

  async release(id: string, tenantId: string, dto: ReleaseOwnershipDto) {
    await this.findById(id, tenantId); // 404 if missing
    const released = await this.ownershipRepo.release(id, tenantId, dto.reason);
    if (!released) {
      throw new BadRequestException(`Ownership layer ${id} is not active`);
    }
    return released;
  }
}
