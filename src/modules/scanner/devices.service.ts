import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DevicesRepository } from './repositories/devices.repository';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { isUniqueViolation } from '../../shared/supabase/postgrest-error.util';

@Injectable()
export class DevicesService {
  constructor(private readonly devicesRepo: DevicesRepository) {}

  findAll(tenantId: string) {
    return this.devicesRepo.findAll(tenantId);
  }

  async findById(id: string, tenantId: string) {
    const device = await this.devicesRepo.findById(id, tenantId);
    if (!device) throw new NotFoundException('Device not found');
    return device;
  }

  async create(tenantId: string, dto: CreateDeviceDto, createdBy: string) {
    try {
      const device = await this.devicesRepo.create(tenantId, {
        device_code: dto.device_code,
        name: dto.name,
        device_type: dto.device_type,
        assigned_to: dto.assigned_to,
        assigned_warehouse_id: dto.assigned_warehouse_id,
        created_by: createdBy,
      });
      if (dto.capabilities?.length) {
        await this.devicesRepo.setCapabilities(
          tenantId,
          device.id,
          dto.capabilities,
        );
      }
      return this.findById(device.id, tenantId);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A device with this code already exists');
      }
      throw error;
    }
  }

  async update(id: string, tenantId: string, dto: UpdateDeviceDto) {
    await this.findById(id, tenantId);
    return this.devicesRepo.update(id, tenantId, dto);
  }

  // Called by the Scanner Event Engine (Phase 4) on every ingested event —
  // not exposed as its own endpoint here, kept on the service so both
  // paths share one write path.
  async touchLastSeen(
    id: string,
    tenantId: string,
    healthStatus: 'healthy' | 'degraded' | 'offline' = 'healthy',
  ) {
    await this.devicesRepo.touchLastSeen(id, tenantId, healthStatus);
  }

  async remove(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    await this.devicesRepo.softDelete(id, tenantId);
  }
}
