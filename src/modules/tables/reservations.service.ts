import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ReservationsRepository } from './repositories/reservations.repository';
import { TablesRepository } from './repositories/tables.repository';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { TenantContext } from '../../core/tenant/tenant-context';

@Injectable()
export class ReservationsService {
  constructor(
    private readonly repo: ReservationsRepository,
    private readonly tablesRepo: TablesRepository,
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

  async update(id: string, tenant: TenantContext, dto: UpdateReservationDto) {
    const reservation = await this.findOne(id, tenant);

    if (dto.status === 'seated' && reservation.status !== 'seated') {
      await this.tablesRepo.update(reservation.table_id, tenant.tenantId, { status: 'occupied' });
    }

    return this.repo.update(id, tenant.tenantId, dto);
  }
}
