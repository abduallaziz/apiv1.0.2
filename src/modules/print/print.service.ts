import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../core/audit/audit.service';
import { StorageService } from '../../shared/storage/storage.service';
import { PrintRepository } from './print.repository';
import {
  normalizeInvoiceTemplate,
  normalizeTemplate,
  resolveTemplate,
} from './print-template.util';
import { buildZatcaQrBase64 } from './zatca-qr.util';
import {
  InvoicePrintPayload,
  InvoiceTemplate,
  KitchenPrintPayload,
  KitchenTemplate,
  TemplateKind,
} from './print.types';

const LOGO_MAX_BYTES = 1024 * 1024; // 1 MB
const LOGO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Kitchen statuses that mean the line has already been sent to / handled by the kitchen. */
const KITCHEN_HANDLED = new Set(['preparing', 'ready', 'served']);

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Magic-byte check so a renamed non-image can never be stored as a logo. */
export function detectImageType(buf: Buffer): string | null {
  if (
    buf.length > 8 &&
    buf
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return 'image/jpeg';
  if (
    buf.length > 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  return null;
}

@Injectable()
export class PrintService {
  private readonly logger = new Logger(PrintService.name);

  constructor(
    private readonly repo: PrintRepository,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- templates

  /**
   * Template for the designer. scope=tenant (no branch_id) returns the tenant
   * template; with branch_id returns that branch's override, or — when it has
   * none — a copy of the tenant template to start editing from.
   */
  async getTemplate(tenantId: string, kind: TemplateKind, branchId?: string) {
    const tenant = await this.requireTenant(tenantId);
    const tenantKey =
      kind === 'invoice' ? 'invoice_template' : 'kitchen_template';
    const branches = await this.repo.listBranchTemplates(tenantId, kind);
    const branchList = branches.map((b) => ({
      id: b.id as string,
      name: b.name as string,
      has_override: this.hasOverride(b[tenantKey]),
    }));

    let raw: unknown = tenant[tenantKey];
    let hasOverride = false;
    if (branchId) {
      const b = branches.find((x) => x.id === branchId);
      if (!b) throw new NotFoundException('Branch not found');
      hasOverride = this.hasOverride(b[tenantKey]);
      if (hasOverride) raw = b[tenantKey];
    }
    return {
      kind,
      scope: branchId ? 'branch' : 'tenant',
      branch_id: branchId ?? null,
      has_override: hasOverride,
      template: resolveTemplate(
        kind,
        raw,
        null,
        tenant.printer_settings?.paper_width,
      ).template,
      branches: branchList,
      logo_url: await this.signLogo(
        kind === 'invoice' ? normalizeInvoiceTemplate(raw).logo_path : null,
      ),
      // Values used when a template field is left empty.
      fallbacks: {
        business_name: tenant.name ?? null,
        address: tenant.address ?? null,
        phone: tenant.phone ?? null,
        tax_number: tenant.tax_number ?? null,
        logo_url: tenant.logo_url ?? null,
        footer: tenant.invoice_footer ?? null,
      },
    };
  }

  async updateTemplate(
    tenantId: string,
    actorId: string | undefined,
    kind: TemplateKind,
    rawTemplate: unknown,
    branchId?: string,
  ) {
    await this.requireTenant(tenantId);
    const template = normalizeTemplate(kind, rawTemplate, true);
    if (kind === 'invoice')
      this.assertLogoPathInTenant(tenantId, template as InvoiceTemplate);
    if (branchId) {
      const ok = await this.repo.saveBranchTemplate(
        tenantId,
        branchId,
        kind,
        template,
      );
      if (!ok) throw new NotFoundException('Branch not found');
    } else {
      await this.repo.saveTenantTemplate(tenantId, kind, template);
    }
    await this.logAudit(
      tenantId,
      actorId,
      `print_template.${kind}.updated`,
      branchId,
    );
    return this.getTemplate(tenantId, kind, branchId);
  }

  /** Removes a branch override so the branch uses the tenant template again. */
  async clearBranchOverride(
    tenantId: string,
    actorId: string | undefined,
    kind: TemplateKind,
    branchId: string,
  ) {
    const ok = await this.repo.saveBranchTemplate(
      tenantId,
      branchId,
      kind,
      null,
    );
    if (!ok) throw new NotFoundException('Branch not found');
    await this.logAudit(
      tenantId,
      actorId,
      `print_template.${kind}.override_cleared`,
      branchId,
    );
    return this.getTemplate(tenantId, kind, branchId);
  }

  async uploadLogo(
    tenantId: string,
    actorId: string,
    file:
      | { buffer: Buffer; originalname: string; mimetype: string; size: number }
      | undefined,
  ) {
    if (!file?.buffer?.length)
      throw new BadRequestException('file is required');
    if (file.size > LOGO_MAX_BYTES || file.buffer.length > LOGO_MAX_BYTES) {
      throw new BadRequestException('Logo must be 1 MB or smaller');
    }
    const detected = detectImageType(file.buffer);
    if (!detected || !LOGO_TYPES[detected] || file.mimetype !== detected) {
      throw new BadRequestException('Logo must be a PNG, JPEG or WebP image');
    }
    const result = await this.storage.upload({
      tenantId,
      ownerType: 'print-logo',
      ownerId: tenantId,
      uploadedBy: actorId,
      fileName: `logo.${LOGO_TYPES[detected]}`,
      fileType: detected,
      fileBuffer: file.buffer,
    });
    return { logo_path: result.storagePath, logo_url: result.fileUrl };
  }

  // ---------------------------------------------------------------- payloads

  async getInvoicePayload(
    tenantId: string,
    orderId: string,
    opts: { tendered?: number } = {},
  ): Promise<InvoicePrintPayload> {
    const tenant = await this.requireTenant(tenantId);
    const order = await this.requireOrder(tenantId, orderId);
    const branch = order.branch_id
      ? await this.repo.getBranch(tenantId, order.branch_id)
      : null;
    const { template } = resolveTemplate(
      'invoice',
      tenant.invoice_template,
      branch?.invoice_template,
      tenant.printer_settings?.paper_width,
    );
    const t = template as InvoiceTemplate;

    const [items, cashier, customer] = await Promise.all([
      this.repo.getOrderItems(orderId),
      this.repo.getCashierName(tenantId, order.cashier_id ?? null),
      this.repo.getCustomer(tenantId, order.customer_id ?? null),
    ]);

    const total = num(order.total);
    const tax = num(order.tax);
    const business = {
      name: t.business_name ?? tenant.name ?? '',
      address: t.address ?? branch?.address ?? tenant.address ?? null,
      phone: t.phone ?? tenant.phone ?? null,
      tax_number: t.tax_number ?? tenant.tax_number ?? null,
      commercial_register: t.commercial_register,
      logo_url: t.show_logo
        ? ((await this.signLogo(t.logo_path)) ??
          t.logo_url ??
          tenant.logo_url ??
          null)
        : null,
      footer: t.footer ?? tenant.invoice_footer ?? null,
    };

    const payments = this.buildPayments(order, total);
    const tendered =
      order.payment_method === 'cash' &&
      opts.tendered !== undefined &&
      Number.isFinite(opts.tendered) &&
      opts.tendered >= total
        ? round2(opts.tendered)
        : null;

    const qr =
      t.qr_enabled && business.tax_number
        ? buildZatcaQrBase64({
            sellerName: business.name,
            vatNumber: business.tax_number,
            timestamp: order.created_at,
            totalWithVat: total,
            vatAmount: tax,
          })
        : null;

    return {
      kind: 'invoice',
      order_id: order.id,
      // the sequential legal number when the order has one, else the short id (older orders)
      invoice_no: (order.invoice_no as string | null) ?? null,
      order_number:
        (order.invoice_no as string | null) ??
        String(order.id).slice(-6).toUpperCase(),
      created_at: order.created_at,
      currency_symbol: tenant.currency_symbol ?? '',
      template: t,
      auto_print: tenant.printer_settings?.auto_print === true,
      business,
      status: order.status,
      items: items.map((i: any) => ({
        name: i.item_name,
        variant_name: i.variant_name ?? null,
        quantity: num(i.qty),
        unit_price: num(i.price),
        total: num(i.total_price) || round2(num(i.qty) * num(i.price)),
      })),
      totals: {
        subtotal: num(order.subtotal),
        discount: num(order.discount),
        tax,
        total,
        tax_rate: num(tenant.tax_rate),
        tax_inclusive: !!tenant.tax_inclusive_pricing,
      },
      payments,
      cash_tendered: tendered,
      change: tendered !== null ? round2(tendered - total) : null,
      cashier_name: cashier,
      customer: customer
        ? { name: customer.full_name ?? null, phone: customer.phone ?? null }
        : null,
      vehicle_plate: customer?.plate_number ?? null,
      worker_name: null,
      note: order.notes ?? null,
      qr_base64: qr,
    };
  }

  /**
   * Kitchen ticket: items + quantities + notes, NO prices. Items already
   * preparing/ready/served are skipped (they were handled); items with a null
   * kitchen_status (non dine-in orders) and 'pending' ones are included.
   * `all=true` reprints every line. Nothing is marked "sent" by printing.
   */
  async getKitchenPayload(
    tenantId: string,
    orderId: string,
    opts: { all?: boolean } = {},
  ): Promise<KitchenPrintPayload> {
    const tenant = await this.requireTenant(tenantId);
    const order = await this.requireOrder(tenantId, orderId);
    const branch = order.branch_id
      ? await this.repo.getBranch(tenantId, order.branch_id)
      : null;
    const { template } = resolveTemplate(
      'kitchen',
      tenant.kitchen_template,
      branch?.kitchen_template,
      tenant.printer_settings?.paper_width,
    );
    const t = template as KitchenTemplate;

    const [rows, cashier, customer, tableName] = await Promise.all([
      this.repo.getOrderItems(orderId),
      this.repo.getCashierName(tenantId, order.cashier_id ?? null),
      this.repo.getCustomer(tenantId, order.customer_id ?? null),
      this.repo.getTableName(tenantId, order.table_id ?? null),
    ]);
    const items = rows
      .filter((i: any) => opts.all || !KITCHEN_HANDLED.has(i.kitchen_status))
      .map((i: any) => ({
        name: i.item_name as string,
        variant_name: (i.variant_name as string | null) ?? null,
        quantity: num(i.qty),
        kitchen_status: (i.kitchen_status as string | null) ?? null,
      }));

    return {
      kind: 'kitchen',
      order_id: order.id,
      order_number: String(order.id).slice(-6).toUpperCase(),
      created_at: order.created_at,
      currency_symbol: tenant.currency_symbol ?? '',
      template: t,
      auto_print: tenant.printer_settings?.auto_print === true,
      header_text: t.header_text,
      business_name: tenant.name ?? '',
      table_name: tableName,
      vehicle_plate: customer?.plate_number ?? null,
      cashier_name: cashier,
      items,
      note: order.notes ?? null,
      only_unsent: !opts.all,
    };
  }

  // ---------------------------------------------------------------- helpers

  private buildPayments(order: any, total: number) {
    if (order.payment_method === 'split') {
      const lines: { method: string; amount: number }[] = [];
      if (order.cash_amount != null)
        lines.push({ method: 'cash', amount: num(order.cash_amount) });
      if (order.card_amount != null)
        lines.push({ method: 'card', amount: num(order.card_amount) });
      if (lines.length) return lines;
    }
    return order.payment_method
      ? [{ method: order.payment_method as string, amount: total }]
      : [];
  }

  private hasOverride(v: unknown) {
    return (
      typeof v === 'object' &&
      v !== null &&
      !Array.isArray(v) &&
      Object.keys(v).length > 0
    );
  }

  /** A saved logo_path must live under this tenant's own prefix. */
  private assertLogoPathInTenant(tenantId: string, t: InvoiceTemplate) {
    if (t.logo_path && !t.logo_path.startsWith(`${tenantId}/print-logo/`)) {
      throw new BadRequestException('logo_path does not belong to this tenant');
    }
  }

  private async signLogo(path: string | null): Promise<string | null> {
    if (!path) return null;
    try {
      return await this.storage.getSignedUrl(path);
    } catch (e) {
      this.logger.warn(`Could not sign logo URL: ${(e as Error).message}`);
      return null;
    }
  }

  private async requireTenant(tenantId: string) {
    const tenant = await this.repo.getTenant(tenantId);
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant as Record<string, any>;
  }

  private async requireOrder(tenantId: string, orderId: string) {
    const order = await this.repo.getOrder(tenantId, orderId);
    if (!order) throw new NotFoundException('Order not found');
    return order as Record<string, any>;
  }

  private async logAudit(
    tenantId: string,
    actorId: string | undefined,
    action: string,
    branchId?: string,
  ) {
    if (!actorId) return;
    await this.audit
      .log({
        tenant_id: tenantId,
        actor_id: actorId,
        action,
        resource_type: 'print_template',
        resource_id: branchId ?? tenantId,
      })
      .catch(() => {});
  }
}
