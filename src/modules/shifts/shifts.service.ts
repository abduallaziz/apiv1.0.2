import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ShiftsRepository } from './shifts.repository';
import { ShiftEngine } from '../../engines/shift-engine/shift.engine';
import { AuditService } from '../../core/audit/audit.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { NotificationService } from '../../core/notification/notification.service';
import { NOTIFICATION_TYPES, NOTIFICATION_CHANNELS } from '../../core/notification/notification.constants';
import { TenantContext } from '../../core/tenant/tenant.context';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';

@Injectable()
export class ShiftsService {
  constructor(
    private readonly repo: ShiftsRepository,
    private readonly engine: ShiftEngine,
    private readonly audit: AuditService,
    private readonly metricsService: MetricsService,
    private readonly notificationService: NotificationService,
  ) {}

  async openShift(
    dto: OpenShiftDto,
    tenant: TenantContext,
    actorId: string,
    actorRole: string,
    ip: string,
    device: string,
  ) {
    const existing = await this.repo.findOpenByUser(actorId, tenant.tenantId);
    this.engine.validateNoDoubleShift(!!existing);

    const shift = await this.repo.create({
      tenant_id: tenant.tenantId,
      branch_id: dto.branch_id,
      cashier_id: actorId,
      opening_cash: dto.opening_cash,
      notes: dto.notes,
    });

    await this.audit.log({
      tenant_id: tenant.tenantId,
      actor_id: actorId,
      actor_role: actorRole,
      action: 'shift.open',
      resource_type: 'shift',
      resource_id: shift.id,
      before_data: null,
      after_data: shift,
      ip_address: ip,
      device,
    });

    this.metricsService.recordShift(tenant.tenantId, 'open');

    this.notificationService.notify({
      userId: actorId,
      tenantId: tenant.tenantId,
      type: NOTIFICATION_TYPES.SHIFT_OPENED,
      channels: [NOTIFICATION_CHANNELS.IN_APP],
      data: { shift_id: shift.id, opening_cash: dto.opening_cash },
    }).catch(() => {});

    return shift;
  }

  async closeShift(
    shiftId: string,
    dto: CloseShiftDto,
    tenant: TenantContext,
    actorId: string,
    actorRole: string,
    ip: string,
    device: string,
  ) {
    const shift = await this.repo.findById(shiftId, tenant.tenantId);
    if (!shift) throw new NotFoundException('Shift not found');
    if (shift.status === 'closed') throw new BadRequestException('Shift already closed');
    if (shift.cashier_id !== actorId) throw new BadRequestException('Not your shift');

    const invoices = await this.repo.getShiftInvoices(shiftId, tenant.tenantId);
    const expenses = await this.repo.getShiftExpenses(shiftId, tenant.tenantId);

    const summary = this.engine.buildShiftSummary({
      openingCash: Number(shift.opening_cash),
      closingCash: dto.closing_cash,
      invoices,
      expenses,
    });

    const closed = await this.repo.close(shiftId, tenant.tenantId, {
      closing_cash: dto.closing_cash,
      expected_cash: summary.expectedCash,
      discrepancy: summary.discrepancy,
    });

    await this.audit.log({
      tenant_id: tenant.tenantId,
      actor_id: actorId,
      actor_role: actorRole,
      action: 'shift.close',
      resource_type: 'shift',
      resource_id: shiftId,
      before_data: shift,
      after_data: closed,
      ip_address: ip,
      device,
    });

    this.metricsService.recordShift(tenant.tenantId, 'close');

    this.notificationService.notify({
      userId: actorId,
      tenantId: tenant.tenantId,
      type: NOTIFICATION_TYPES.SHIFT_CLOSED,
      channels: [NOTIFICATION_CHANNELS.IN_APP],
      data: {
        shift_id: shiftId,
        total: summary.totalInvoices,
        discrepancy: summary.discrepancy,
      },
    }).catch(() => {});

    return { shift: closed, summary };
  }

  // No physical cash-drawer hardware integration exists in this codebase
  // (confirmed — no printer/terminal driver, no drawer table). This just
  // records the action for accountability, same audit_logs table shifts
  // themselves already write to. A real hardware trigger can be added
  // later without changing this call site.
  async logDrawerOpen(
    tenant: TenantContext,
    actorId: string,
    actorRole: string,
    ip: string,
    device: string,
  ) {
    const shift = await this.repo.findOpenByUser(actorId, tenant.tenantId);
    if (!shift) throw new BadRequestException('No open shift — open a shift before opening the drawer');

    await this.audit.log({
      tenant_id: tenant.tenantId,
      actor_id: actorId,
      actor_role: actorRole,
      action: 'pos.drawer_opened',
      resource_type: 'shift',
      resource_id: shift.id,
      after_data: { branch_id: shift.branch_id, opened_at: new Date().toISOString() },
      ip_address: ip,
      device,
    });

    return { logged: true, shift_id: shift.id };
  }

  async findAll(tenant: TenantContext, branchId?: string) {
    return this.repo.findAll(tenant.tenantId, branchId);
  }

  async getCurrentShift(tenant: TenantContext, actorId: string, branchId?: string) {
    if (branchId) {
      return this.repo.findCurrentByBranch(branchId, tenant.tenantId);
    }
    return this.repo.findOpenByUser(actorId, tenant.tenantId);
  }

  async getShiftSummary(shiftId: string, tenant: TenantContext) {
    const shift = await this.repo.findById(shiftId, tenant.tenantId);
    if (!shift) throw new NotFoundException('Shift not found');

    const invoices = await this.repo.getShiftInvoices(shiftId, tenant.tenantId);
    const expenses = await this.repo.getShiftExpenses(shiftId, tenant.tenantId);

    const summary = this.engine.buildShiftSummary({
      openingCash: Number(shift.opening_cash),
      closingCash: Number(shift.closing_cash ?? 0),
      invoices,
      expenses,
    });

    return { shift, summary };
  }
}