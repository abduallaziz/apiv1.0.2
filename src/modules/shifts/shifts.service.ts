import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ShiftsRepository } from './shifts.repository';
import {
  ShiftEngine,
  COUNTED_METHODS,
  CountedMethod,
} from '../../engines/shift-engine/shift.engine';
import { AuditService } from '../../core/audit/audit.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { NotificationService } from '../../core/notification/notification.service';
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
} from '../../core/notification/notification.constants';
import { TenantContext } from '../../core/tenant/tenant.context';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { PdfRendererService } from './report/pdf-renderer.service';
import {
  buildShiftReportHtml,
  ReportLabels,
  ReportLang,
} from './report/shift-report.html';
import { I18nService } from '../../core/i18n/i18n.service';
import { safeTimezone } from '../../shared/time/tenant-time.util';

@Injectable()
export class ShiftsService {
  constructor(
    private readonly repo: ShiftsRepository,
    private readonly engine: ShiftEngine,
    private readonly audit: AuditService,
    private readonly metricsService: MetricsService,
    private readonly notificationService: NotificationService,
    private readonly pdfRenderer: PdfRendererService,
    private readonly i18n: I18nService,
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

    // S1 (phase 4): the check above is read-then-write; the partial UNIQUE
    // index uq_shifts_one_open_per_cashier is what really guarantees one open
    // register per cashier, so two simultaneous opens end here as a clean 400.
    let shift;
    try {
      shift = await this.repo.create({
        tenant_id: tenant.tenantId,
        branch_id: dto.branch_id,
        cashier_id: actorId,
        opening_cash: dto.opening_cash,
        notes: dto.notes,
      });
    } catch (e) {
      if (/uq_shifts_one_open_per_cashier|duplicate key/i.test((e as Error).message)) {
        throw new BadRequestException('A shift is already open for this cashier');
      }
      throw e;
    }

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

    this.notificationService
      .notify({
        userId: actorId,
        tenantId: tenant.tenantId,
        type: NOTIFICATION_TYPES.SHIFT_OPENED,
        channels: [NOTIFICATION_CHANNELS.IN_APP],
        data: { shift_id: shift.id, opening_cash: dto.opening_cash },
      })
      .catch(() => {});

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
    if (shift.status === 'closed')
      throw new BadRequestException('Shift already closed');
    if (shift.cashier_id !== actorId)
      throw new BadRequestException('Not your shift');

    // Phase 2 (owner approved 2026-11-09): blind count. The cashier sends
    // what was physically counted per payment method; expected figures and
    // differences are computed here and stored with an immutable report.
    const counts = this.parseCounts(dto);

    // S6 (phase 4): the closing, the stored report and the per-method counts
    // are written by ONE database function that locks the register and checks
    // that its sales/returns are still exactly what these figures were
    // computed from. If a sale slipped in meanwhile it refuses
    // (SHIFT_ACTIVITY_CHANGED) and the figures are recomputed.
    let summary!: ReturnType<ShiftEngine['buildShiftSummary']>;
    let report!: Awaited<ReturnType<ShiftsService['buildReport']>>;
    let closed: Record<string, unknown> = {};
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; ; attempt++) {
      const invoices = await this.repo.getShiftInvoices(shiftId, tenant.tenantId);
      const expenses = await this.repo.getShiftExpenses(shiftId, tenant.tenantId);
      const returns = await this.repo.getShiftReturns(shiftId, tenant.tenantId);

      summary = this.engine.buildShiftSummary({
        openingCash: Number(shift.opening_cash),
        closingCash: counts.cash,
        invoices,
        expenses,
        returns,
      });

      const closedAt = new Date().toISOString();
      report = await this.buildReport({
        shift,
        summary,
        counts,
        closedAt,
        notes: dto.notes ?? null,
        legacy: false,
      });

      try {
        closed = (await this.repo.closeAtomic({
          tenantId: tenant.tenantId,
          shiftId,
          closedBy: actorId,
          closingCash: counts.cash,
          expectedCash: summary.expectedCash,
          discrepancy: summary.discrepancy,
          notes: dto.notes ?? null,
          closedAt,
          report,
          counts: report.methods
            .filter((m) => m.counted !== null)
            .map((m) => ({
              payment_method: m.method,
              counted: m.counted as number,
              expected: m.expected,
              difference: m.difference as number,
            })),
          fingerprint: {
            orders: invoices.length,
            ordersTotal: invoices.reduce((t, i) => t + Number(i.total ?? 0), 0),
            returns: returns.length,
            returnsTotal: returns.reduce(
              (t, r) => t + Number(r.refund_total ?? 0),
              0,
            ),
          },
        })) as Record<string, unknown>;
        break;
      } catch (e) {
        const message = (e as { message?: string }).message ?? '';
        if (message.includes('SHIFT_ACTIVITY_CHANGED') && attempt < MAX_ATTEMPTS) {
          continue;
        }
        if (message.includes('SHIFT_ACTIVITY_CHANGED')) {
          throw new BadRequestException(
            'The register activity kept changing while closing; try again',
          );
        }
        if (message.includes('Shift already closed')) {
          throw new BadRequestException('Shift already closed');
        }
        if (message.includes('Shift not found')) {
          throw new NotFoundException('Shift not found');
        }
        throw e;
      }
    }

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

    this.notificationService
      .notify({
        userId: actorId,
        tenantId: tenant.tenantId,
        type: NOTIFICATION_TYPES.SHIFT_CLOSED,
        channels: [NOTIFICATION_CHANNELS.IN_APP],
        data: {
          shift_id: shiftId,
          total: summary.totalInvoices,
          discrepancy: summary.discrepancy,
        },
      })
      .catch(() => {});

    return { shift: closed, summary, report };
  }

  // Validates the blind-count payload. Missing methods count as 0; the
  // legacy `closing_cash` is accepted when counts.cash is absent.
  private parseCounts(dto: CloseShiftDto): Record<CountedMethod, number> {
    const out: Record<CountedMethod, number> = {
      cash: 0,
      mada: 0,
      visa: 0,
      mastercard: 0,
    };
    const input = dto.counts ?? {};
    for (const key of Object.keys(input)) {
      if (!(COUNTED_METHODS as readonly string[]).includes(key)) {
        throw new BadRequestException(`Unknown payment method: ${key}`);
      }
      const value = Number(input[key]);
      if (!Number.isFinite(value) || value < 0) {
        throw new BadRequestException(
          `Counted amount for ${key} must be a number >= 0`,
        );
      }
      out[key as CountedMethod] = value;
    }
    if (input.cash === undefined) {
      if (dto.closing_cash === undefined) {
        throw new BadRequestException('Counted cash is required');
      }
      out.cash = Number(dto.closing_cash);
    }
    return out;
  }

  private async buildReport(params: {
    shift: {
      id: string;
      opened_at: string;
      cashier_id: string;
      branch_id: string;
      notes?: string | null;
    };
    summary: ReturnType<ShiftEngine['buildShiftSummary']>;
    counts: Record<CountedMethod, number>;
    closedAt: string;
    notes: string | null;
    legacy: boolean;
  }) {
    const { shift, summary, counts, closedAt, legacy } = params;
    const tenantId = (shift as unknown as { tenant_id: string }).tenant_id;
    const extras = await this.repo.getShiftOrderExtras(shift.id, tenantId);
    const names = await this.repo.getNames(
      tenantId,
      shift.cashier_id,
      shift.branch_id,
    );
    return this.engine.buildCloseReport({
      summary,
      counts,
      shift: {
        id: shift.id,
        opened_at: shift.opened_at,
        closed_at: closedAt,
        cashier_id: shift.cashier_id,
        cashier_name: names.cashierName,
        branch_id: shift.branch_id,
        branch_name: names.branchName,
        notes: params.notes ?? shift.notes ?? null,
      },
      itemsCount: extras.itemsCount,
      discountTotal: extras.discountTotal,
      taxTotal: extras.taxTotal,
      cancelled: extras.cancelled,
      legacy,
    });
  }

  // The close report as a real PDF (headless Chrome). `lang` picks the
  // labels (ar | en); amounts and dates always use English numerals.
  async getShiftReportPdf(
    shiftId: string,
    tenant: TenantContext,
    lang: ReportLang,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const report = await this.getShiftReport(shiftId, tenant);
    const meta = await this.repo.getTenantMeta(tenant.tenantId);
    const html = buildShiftReportHtml(
      report,
      lang,
      meta.currency,
      safeTimezone(meta.timezone),
      this.i18n.bundle('shift_report', lang) as unknown as ReportLabels,
    );
    const buffer = await this.pdfRenderer.renderSinglePage(html);
    const stamp = String(report.shift.closed_at ?? '')
      .replace(/[^0-9]/g, '')
      .slice(0, 12);
    return { buffer, fileName: `register-report-${stamp || shiftId}.pdf` };
  }

  // The close report of a CLOSED register. A register closed after phase 2
  // returns its stored immutable snapshot; one closed before it has none,
  // so a report is built now from its data (marked legacy: only the cash
  // count was ever recorded).
  async getShiftReport(shiftId: string, tenant: TenantContext) {
    const shift = await this.repo.findById(shiftId, tenant.tenantId);
    if (!shift) throw new NotFoundException('Shift not found');
    if (shift.status !== 'closed') {
      throw new BadRequestException(
        'The report is available after the register is closed',
      );
    }
    if (shift.report_snapshot) return shift.report_snapshot;

    const invoices = await this.repo.getShiftInvoices(shiftId, tenant.tenantId);
    const expenses = await this.repo.getShiftExpenses(shiftId, tenant.tenantId);
    const returns = await this.repo.getShiftReturns(shiftId, tenant.tenantId);
    const closingCash = Number(shift.closing_cash ?? 0);
    const summary = this.engine.buildShiftSummary({
      openingCash: Number(shift.opening_cash),
      closingCash,
      invoices,
      expenses,
      returns,
    });
    return this.buildReport({
      shift,
      summary,
      counts: { cash: closingCash, mada: 0, visa: 0, mastercard: 0 },
      closedAt: shift.closed_at ?? new Date().toISOString(),
      notes: shift.close_notes ?? null,
      legacy: true,
    });
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
    if (!shift)
      throw new BadRequestException(
        'No open shift — open a shift before opening the drawer',
      );

    await this.audit.log({
      tenant_id: tenant.tenantId,
      actor_id: actorId,
      actor_role: actorRole,
      action: 'pos.drawer_opened',
      resource_type: 'shift',
      resource_id: shift.id,
      after_data: {
        branch_id: shift.branch_id,
        opened_at: new Date().toISOString(),
      },
      ip_address: ip,
      device,
    });

    return { logged: true, shift_id: shift.id };
  }

  async findAll(tenant: TenantContext, branchId?: string) {
    return this.repo.findAll(tenant.tenantId, branchId);
  }

  async getCurrentShift(
    tenant: TenantContext,
    actorId: string,
    _branchId?: string,
  ) {
    // Phase 4 (S2, owner decision Q1: a register per cashier): "the current
    // register" is the one OPENED BY THIS USER. It used to be the branch's
    // latest open register whoever opened it, which would show a manager
    // "register open" and then reject every sale (it is not his). A register in
    // another branch than the working one is reported as such when selling.
    return this.repo.findOpenByUser(actorId, tenant.tenantId);
  }

  // Called by InvoicesService.create() before any sale is written — the cash
  // register session is the financial boundary for POS sales (see
  // STATUS.md "Cash Register Session" migration). Kept here rather than
  // duplicated in InvoicesService so the "what counts as an open session"
  // rule has exactly one owner.
  // S2 (phase 4): the client sends shift_id, so "open" is not enough: the
  // register must belong to THIS cashier and THIS branch (a register per
  // cashier, owner decision Q1). The database trigger
  // fn_orders_require_open_shift enforces the same rule as a backstop.
  async assertOpenSession(
    tenantId: string,
    shiftId?: string | null,
    cashierId?: string | null,
    branchId?: string | null,
  ): Promise<void> {
    if (!shiftId) {
      throw new BadRequestException(
        'NO_ACTIVE_CASH_SESSION: no cash register session id was provided',
      );
    }
    const shift = await this.repo.findById(shiftId, tenantId);
    if (!shift || shift.status !== 'open') {
      throw new BadRequestException(
        'NO_ACTIVE_CASH_SESSION: cash register session is not open',
      );
    }
    if (cashierId && shift.cashier_id !== cashierId) {
      throw new BadRequestException(
        'NO_ACTIVE_CASH_SESSION: this cash register session belongs to another cashier',
      );
    }
    if (branchId && shift.branch_id !== branchId) {
      throw new BadRequestException(
        'NO_ACTIVE_CASH_SESSION: this cash register session belongs to another branch',
      );
    }
  }

  async getShiftSummary(shiftId: string, tenant: TenantContext) {
    const shift = await this.repo.findById(shiftId, tenant.tenantId);
    if (!shift) throw new NotFoundException('Shift not found');

    const invoices = await this.repo.getShiftInvoices(shiftId, tenant.tenantId);
    const expenses = await this.repo.getShiftExpenses(shiftId, tenant.tenantId);
    const returns = await this.repo.getShiftReturns(shiftId, tenant.tenantId);

    const summary = this.engine.buildShiftSummary({
      openingCash: Number(shift.opening_cash),
      closingCash: Number(shift.closing_cash ?? 0),
      invoices,
      expenses,
      returns,
    });

    return { shift, summary };
  }
}
