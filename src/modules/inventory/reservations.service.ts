import { Injectable, NotFoundException } from '@nestjs/common';
import { ReservationsRepository } from './repositories/reservations.repository';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { throwFromRpcError } from './rpc-error.util';

@Injectable()
export class ReservationsService {
  constructor(private readonly reservationsRepo: ReservationsRepository) {}

  findAll(tenantId: string, status?: string) {
    return this.reservationsRepo.findAll(tenantId, status);
  }

  async findById(id: string, tenantId: string) {
    const reservation = await this.reservationsRepo.findById(id, tenantId);
    if (!reservation) throw new NotFoundException('Reservation not found');
    return reservation;
  }

  async create(tenantId: string, dto: CreateReservationDto, actorId: string) {
    try {
      return await this.reservationsRepo.create({
        p_tenant_id: tenantId,
        p_warehouse_id: dto.warehouse_id,
        p_item_id: dto.item_id,
        p_variant_id: dto.variant_id ?? null,
        p_batch_id: dto.batch_id ?? null,
        p_quantity: dto.quantity,
        p_reference_type: dto.reference_type,
        p_reference_id: dto.reference_id,
        p_created_by: actorId,
        p_expires_at: dto.expires_at ?? null,
      });
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  async release(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    try {
      return await this.reservationsRepo.release(id, 'released');
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }
}
