import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkCentersRepository } from './repositories/work-centers.repository';
import { WarehousesService } from '../inventory/warehouses.service';
import { CreateWorkCenterDto } from './dto/create-work-center.dto';
import { UpdateWorkCenterDto } from './dto/update-work-center.dto';

@Injectable()
export class WorkCentersService {
  constructor(
    private readonly workCentersRepo: WorkCentersRepository,
    private readonly warehousesService: WarehousesService,
  ) {}

  findAll(tenantId: string) {
    return this.workCentersRepo.findAll(tenantId);
  }

  async findById(id: string, tenantId: string) {
    const workCenter = await this.workCentersRepo.findById(id, tenantId);
    if (!workCenter) throw new NotFoundException('Work center not found');
    return workCenter;
  }

  async create(tenantId: string, dto: CreateWorkCenterDto) {
    if (dto.warehouse_id) {
      await this.warehousesService.findById(dto.warehouse_id, tenantId); // throws NotFoundException if missing
    }
    return this.workCentersRepo.create(tenantId, {
      name: dto.name,
      warehouse_id: dto.warehouse_id ?? null,
      is_active: dto.is_active ?? true,
    });
  }

  async update(id: string, tenantId: string, dto: UpdateWorkCenterDto) {
    await this.findById(id, tenantId);
    if (dto.warehouse_id) {
      await this.warehousesService.findById(dto.warehouse_id, tenantId);
    }
    return this.workCentersRepo.update(id, tenantId, { ...dto });
  }

  async activate(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.workCentersRepo.setActive(id, tenantId, true);
  }

  async deactivate(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.workCentersRepo.setActive(id, tenantId, false);
  }
}
