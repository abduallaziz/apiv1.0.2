import { Injectable, NotFoundException } from '@nestjs/common';
import { WmsRepository } from './repositories/wms.repository';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { CreatePickListDto } from './dto/create-pick-list.dto';
import { LocationsService } from './locations.service';
import { StockService } from './stock.service';
import { throwFromRpcError } from './rpc-error.util';

@Injectable()
export class WmsService {
  constructor(
    private readonly wmsRepo: WmsRepository,
    private readonly locationsService: LocationsService,
    private readonly stockService: StockService,
  ) {}

  // Shipments

  async findShipments(tenantId: string, status?: string) {
    return (await this.wmsRepo.findShipments(tenantId, status)) ?? [];
  }

  async findShipmentById(id: string, tenantId: string) {
    const shipment = await this.wmsRepo.findShipmentById(id, tenantId);
    if (!shipment) throw new NotFoundException('Shipment not found');
    return shipment;
  }

  async createShipment(tenantId: string, dto: CreateShipmentDto) {
    const { items, ...header } = dto;

    for (const line of items) {
      if (line.location_id) {
        await this.locationsService.findById(line.location_id, header.warehouse_id, tenantId);
      }
    }

    return this.wmsRepo.createShipment(
      tenantId,
      {
        warehouse_id: header.warehouse_id,
        reference_type: header.reference_type,
        reference_id: header.reference_id,
      },
      items.map((line) => ({
        item_id: line.item_id,
        variant_id: line.variant_id ?? null,
        location_id: line.location_id ?? null,
        quantity_requested: line.quantity_requested,
      })),
    );
  }

  async cancelShipment(id: string, tenantId: string) {
    await this.findShipmentById(id, tenantId);
    try {
      return await this.wmsRepo.cancelShipment(id, tenantId);
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  async shipShipment(id: string, tenantId: string, actorId: string, trackingNumber?: string) {
    await this.findShipmentById(id, tenantId);
    try {
      const result = await this.wmsRepo.shipShipment(id, actorId, trackingNumber);
      await this.stockService.invalidateStockCache(tenantId);
      return result;
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  async confirmPack(shipmentLineId: string, tenantId: string, quantity: number, actorId: string) {
    try {
      return await this.wmsRepo.confirmPack(shipmentLineId, quantity, actorId);
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  // Pick lists

  async findPickLists(tenantId: string, status?: string) {
    return (await this.wmsRepo.findPickLists(tenantId, status)) ?? [];
  }

  async findPickListById(id: string, tenantId: string) {
    const pickList = await this.wmsRepo.findPickListById(id, tenantId);
    if (!pickList) throw new NotFoundException('Pick list not found');
    return pickList;
  }

  async createPickList(tenantId: string, dto: CreatePickListDto, actorId: string) {
    try {
      const result = await this.wmsRepo.createPickList(
        tenantId,
        dto.warehouse_id,
        dto.shipment_ids,
        dto.strategy,
        dto.zone_location_id ?? null,
        actorId,
      );
      return result;
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  async confirmPick(pickListLineId: string, tenantId: string, quantity: number, actorId: string) {
    try {
      const result = await this.wmsRepo.confirmPick(pickListLineId, quantity, actorId);
      await this.stockService.invalidateStockCache(tenantId);
      return result;
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }
}
