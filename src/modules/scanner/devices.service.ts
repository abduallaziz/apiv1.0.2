import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DevicesRepository } from './repositories/devices.repository';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { isUniqueViolation } from '../../shared/supabase/postgrest-error.util';
import { WarehousesService } from '../inventory/warehouses.service';
import { AuditService } from '../../core/audit/audit.service';

@Injectable()
export class DevicesService {
  constructor(
    private readonly devicesRepo: DevicesRepository,
    private readonly warehousesService: WarehousesService,
    private readonly auditService: AuditService,
  ) {}

  // Branch System Step 5 (Owner-approved) — see identical helper in
  // ProductionOrdersService. scanner_devices.assigned_warehouse_id is
  // nullable (a device need not be assigned to a warehouse at all) — this
  // correctly returns null in that case, not an error.
  private async resolveBranchForWarehouse(
    warehouseId: string | null | undefined,
    tenantId: string,
  ): Promise<string | null> {
    if (!warehouseId) return null;
    try {
      const warehouse = await this.warehousesService.findById(
        warehouseId,
        tenantId,
      );
      return warehouse?.branch_id ?? null;
    } catch {
      return null;
    }
  }

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
      const full: Record<string, unknown> = await this.findById(
        device.id,
        tenantId,
      );

      await this.auditService
        .log({
          tenant_id: tenantId,
          actor_id: createdBy,
          action: 'scanner_device.created',
          resource_type: 'scanner_device',
          resource_id: (device as { id: string }).id,
          branch_id: await this.resolveBranchForWarehouse(
            dto.assigned_warehouse_id,
            tenantId,
          ),
        })
        .catch(() => {});

      return full;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A device with this code already exists');
      }
      throw error;
    }
  }

  async update(
    id: string,
    tenantId: string,
    dto: UpdateDeviceDto,
    actorId: string,
  ) {
    await this.findById(id, tenantId);
    const updated = (await this.devicesRepo.update(
      id,
      tenantId,
      dto,
    )) as Record<string, unknown>;

    await this.auditService
      .log({
        tenant_id: tenantId,
        actor_id: actorId,
        action: 'scanner_device.updated',
        resource_type: 'scanner_device',
        resource_id: id,
        branch_id: await this.resolveBranchForWarehouse(
          (updated as { assigned_warehouse_id?: string | null })
            ?.assigned_warehouse_id,
          tenantId,
        ),
      })
      .catch(() => {});

    return updated;
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

  async remove(id: string, tenantId: string, actorId: string) {
    const existing = (await this.findById(id, tenantId)) as Record<
      string,
      unknown
    >;
    await this.devicesRepo.softDelete(id, tenantId);

    // Branch resolved BEFORE delete — the resource is gone by the time
    // this line runs otherwise, and this is a DELETE (204 No Content), so
    // there's no response body to fall back on either.
    await this.auditService
      .log({
        tenant_id: tenantId,
        actor_id: actorId,
        action: 'scanner_device.removed',
        resource_type: 'scanner_device',
        resource_id: id,
        branch_id: await this.resolveBranchForWarehouse(
          (existing as { assigned_warehouse_id?: string | null })
            ?.assigned_warehouse_id,
          tenantId,
        ),
      })
      .catch(() => {});
  }
}
