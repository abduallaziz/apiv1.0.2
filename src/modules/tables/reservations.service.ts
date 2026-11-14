import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ReservationsRepository } from './repositories/reservations.repository';
import { DineInService } from './dine-in.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { TenantContext } from '../../core/tenant/tenant-context';
import {
  assertNoConflict,
  assertNotInPast,
  assertPartyFits,
  canChangeStatus,
  conflictWindow,
  ReservationStatus,
} from './reservation-rules';

@Injectable()
export class ReservationsService {
  constructor(
    private readonly repo: ReservationsRepository,
    private readonly dineInService: DineInService,
  ) {}

  findAll(
    tenant: TenantContext,
    filters: { tableId?: string; from?: string; to?: string; status?: string },
  ) {
    return this.repo.findAll(tenant.tenantId, filters);
  }

  async findOne(id: string, tenant: TenantContext) {
    const reservation = await this.repo.findById(id, tenant.tenantId);
    if (!reservation) throw new NotFoundException('Reservation not found');
    return reservation;
  }

  async create(tenant: TenantContext, dto: CreateReservationDto) {
    const table = await this.repo.findTable(dto.table_id, tenant.tenantId);
    if (!table) throw new BadRequestException('Table not found');
    assertNotInPast(dto.reservation_time);
    assertPartyFits(dto.party_size, table.capacity);
    await this.checkConflict(tenant, dto.table_id, dto.reservation_time);
    return this.repo.create(tenant.tenantId, dto);
  }

  async update(
    id: string,
    tenant: TenantContext,
    dto: UpdateReservationDto,
    actorId: string,
  ) {
    const reservation = await this.findOne(id, tenant);
    const from = reservation.status as ReservationStatus;
    const to = dto.status ?? from;

    if (!canChangeStatus(from, to)) {
      throw new BadRequestException(
        `Cannot change a ${from} reservation to ${to}`,
      );
    }
    // Details (time/party/name/notes) can only be edited while it is still open.
    const editsDetails =
      dto.reservation_time !== undefined ||
      dto.party_size !== undefined ||
      dto.customer_name !== undefined ||
      dto.customer_phone !== undefined ||
      dto.notes !== undefined;
    if (editsDetails && from !== 'confirmed') {
      throw new BadRequestException(
        'Only a confirmed reservation can be edited',
      );
    }

    if (to === 'confirmed') {
      const timeChanged = dto.reservation_time !== undefined;
      const reconfirm = from !== 'confirmed';
      if (timeChanged || dto.party_size !== undefined || reconfirm) {
        const table = await this.repo.findTable(
          reservation.table_id,
          tenant.tenantId,
        );
        if (!table) throw new BadRequestException('Table not found');
        const time = dto.reservation_time ?? reservation.reservation_time;
        if (timeChanged || reconfirm) assertNotInPast(time);
        assertPartyFits(
          dto.party_size ?? reservation.party_size,
          table.capacity,
        );
        if (timeChanged || reconfirm) {
          await this.checkConflict(tenant, reservation.table_id, time, id);
        }
      }
    }

    // كان يضبط حالة الطاولة "مشغولة" مباشرة بدون إنشاء أي طلب فعلي — فيظهر الموظف
    // "الطاولة مشغولة" لكن أي محاولة إضافة صنف ترمي "No open order for this table"،
    // لأن جدول الطلبات (orders) لا يعرف شيئًا عن هذا الحجز إطلاقًا. الحل الجذري:
    // فتح الطاولة فعليًا (إنشاء الطلب + ضبط الحالة معًا بعملية واحدة متسقة) بدل تكرار
    // نصف المنطق هنا فقط.
    if (to === 'seated' && from !== 'seated') {
      await this.dineInService.openTable(tenant, reservation.table_id, actorId);
    }

    return this.repo.update(id, tenant.tenantId, dto);
  }

  async remove(id: string, tenant: TenantContext) {
    const reservation = await this.findOne(id, tenant);
    if (reservation.status === 'seated') {
      throw new BadRequestException('A seated reservation cannot be deleted');
    }
    await this.repo.remove(id, tenant.tenantId);
    return { id };
  }

  private async checkConflict(
    tenant: TenantContext,
    tableId: string,
    time: string,
    excludeId?: string,
  ) {
    const w = conflictWindow(time);
    assertNoConflict(
      await this.repo.countActiveInWindow(
        tenant.tenantId,
        tableId,
        w.from,
        w.to,
        excludeId,
      ),
    );
  }
}
