import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ReservationsRepository } from './repositories/reservations.repository';
import { DineInService } from './dine-in.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { TenantContext } from '../../core/tenant/tenant-context';

@Injectable()
export class ReservationsService {
  constructor(
    private readonly repo: ReservationsRepository,
    private readonly dineInService: DineInService,
  ) {}

  findAll(tenant: TenantContext, filters: { tableId?: string; from?: string; to?: string; status?: string }) {
    return this.repo.findAll(tenant.tenantId, filters);
  }

  async findOne(id: string, tenant: TenantContext) {
    const reservation = await this.repo.findById(id, tenant.tenantId);
    if (!reservation) throw new NotFoundException('Reservation not found');
    return reservation;
  }

  async create(tenant: TenantContext, dto: CreateReservationDto) {
    const tableOk = await this.repo.tableBelongsToTenant(dto.table_id, tenant.tenantId);
    if (!tableOk) throw new BadRequestException('Table not found');
    return this.repo.create(tenant.tenantId, dto);
  }

  async update(id: string, tenant: TenantContext, dto: UpdateReservationDto, actorId: string) {
    const reservation = await this.findOne(id, tenant);

    // كان يضبط حالة الطاولة "مشغولة" مباشرة بدون إنشاء أي طلب فعلي — فيظهر الموظف
    // "الطاولة مشغولة" لكن أي محاولة إضافة صنف ترمي "No open order for this table"،
    // لأن جدول الطلبات (orders) لا يعرف شيئًا عن هذا الحجز إطلاقًا. الحل الجذري:
    // فتح الطاولة فعليًا (إنشاء الطلب + ضبط الحالة معًا بعملية واحدة متسقة) بدل تكرار
    // نصف المنطق هنا فقط.
    if (dto.status === 'seated' && reservation.status !== 'seated') {
      await this.dineInService.openTable(tenant, reservation.table_id, actorId);
    }

    return this.repo.update(id, tenant.tenantId, dto);
  }
}
