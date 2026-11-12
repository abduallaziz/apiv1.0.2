import { randomUUID, createPrivateKey, createPublicKey, X509Certificate } from 'crypto';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';
import { TenantContext } from '../../core/tenant/tenant-context';
import { TenantSessionService } from '../../core/tenant/tenant-session.service';
import { buildCsr } from './zatca-csr.util';
import { ZATCA_FIRST_PIH, decryptSecret, encryptSecret, generateDeviceKeyPair } from './zatca-crypto.util';
import { generateSignedDocument } from './zatca-document.service';
import { ZATCA_GATEWAY, type ZatcaGateway } from './zatca.gateway';
import { FatooraGateway } from './fatoora.gateway';
import type { AttachCertificateDto, CreateZatcaDeviceDto } from './dto/zatca.dto';
import type { ZatcaBuyer, ZatcaDocInput, ZatcaLine, ZatcaSeller } from './zatca.types';

export interface IssueContext {
  tenantId: string;
  branchId: string;
  orderId: string;
  invoiceNo: string;
  issuedAt: Date;
  currency: string;
  taxRate: number;
  taxInclusive: boolean;
  lines: ZatcaLine[];
  discount: number;
  /** What the customer paid / the VAT charged (the document must match). */
  total: number;
  tax: number;
  paymentMethod: string;
  /** Buyer: a VAT number makes it a standard (B2B) invoice; otherwise a simplified one. */
  buyer?: ZatcaBuyer | null;
  /** VAT category (default S); Z/E/O carry a VATEX exemption reason. */
  taxCategory?: 'S' | 'Z' | 'E' | 'O';
  exemptionReasonCode?: string | null;
  exemptionReason?: string | null;
}

/** UN/CEFACT payment means for the document. */
export function paymentCode(method: string): '10' | '30' | '42' | '48' {
  if (method === 'tab') return '30';
  if (['card', 'mada', 'visa', 'mastercard', 'apple_pay', 'stc_pay', 'wallet'].includes(method)) return '48';
  return '10'; // cash, split and anything else
}

const DEVICE_PUBLIC_COLUMNS =
  'id, tenant_id, branch_id, env, egs_serial, seller, csid_kind, icv_last, pih_last, status, created_at, updated_at, ' +
  '(private_key_enc IS NOT NULL) AS has_key, (csr_pem IS NOT NULL) AS has_csr, (certificate_pem IS NOT NULL) AS has_certificate';

@Injectable()
export class ZatcaService {
  private readonly logger = new Logger(ZatcaService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly tenantSession: TenantSessionService,
    @Inject(ZATCA_GATEWAY) private readonly gateway: ZatcaGateway,
  ) {}

  /** Issuing documents inside sales is off until the owner switches ZATCA_ENABLED on. */
  get enabled(): boolean {
    return this.config.get<boolean>('ZATCA_ENABLED') === true;
  }

  private masterKey(): string {
    const k = this.config.get<string>('ZATCA_KEY_ENC_KEY');
    if (!k) throw new ServiceUnavailableException('ZATCA_KEY_ENC_KEY is not configured');
    return k;
  }

  // ---------------------------------------------------------------- issuing (inside the sale)

  /**
   * Called INSIDE the sale transaction, right after the sales entry is posted. Locks the branch's
   * device row, advances the ICV counter and the PIH hash chain, signs the document and stores it.
   * The lock makes the chain gap-free and fork-free; a failed sale rolls the counter back with it.
   * No usable device (not onboarded yet) -> returns without issuing (nothing changes for the sale).
   * Any other failure THROWS and fails the sale: a legal document must never be silently missing.
   */
  async issueInTransaction(client: PoolClient, ctx: IssueContext): Promise<{ issued: boolean; reason?: string }> {
    const dev = await client.query(
      `SELECT id, env, seller, private_key_enc, certificate_pem, icv_last, pih_last
         FROM zatca_devices
        WHERE tenant_id = $1 AND branch_id = $2
          AND status IN ('compliance', 'active') AND deleted_at IS NULL
          AND certificate_pem IS NOT NULL AND private_key_enc IS NOT NULL
        ORDER BY (status = 'active') DESC, created_at
        LIMIT 1
        FOR UPDATE`,
      [ctx.tenantId, ctx.branchId],
    );
    if (dev.rows.length === 0) return { issued: false, reason: 'no_device' };
    const d = dev.rows[0];

    const input: ZatcaDocInput = {
      kind: 'invoice',
      invoice_no: ctx.invoiceNo,
      uuid: randomUUID(),
      icv: Number(d.icv_last) + 1,
      pih: d.pih_last as string,
      issue_at: ctx.issuedAt,
      currency: ctx.currency,
      tax_rate: ctx.taxRate,
      tax_inclusive: ctx.taxInclusive,
      lines: ctx.lines,
      discount: ctx.discount,
      payment_code: paymentCode(ctx.paymentMethod),
      buyer: ctx.buyer ?? null,
      tax_category: ctx.taxCategory ?? 'S',
      exemption_reason_code: ctx.exemptionReasonCode ?? undefined,
      exemption_reason: ctx.exemptionReason ?? undefined,
      seller: d.seller as ZatcaSeller,
    };
    await this.storeDocument(client, d, ctx.tenantId, ctx.orderId, input, { orderTotal: ctx.total, orderTax: ctx.tax });
    return { issued: true };
  }

  /** Signs `input`, stores it with its input snapshot and advances the device's ICV / PIH chain. */
  private async storeDocument(
    client: PoolClient,
    d: { id: string; private_key_enc: string; certificate_pem: string },
    tenantId: string,
    orderId: string,
    input: ZatcaDocInput,
    check?: { orderTotal: number; orderTax: number },
    returnId: string | null = null,
  ) {
    const doc = generateSignedDocument(
      input,
      {
        privateKeyPem: decryptSecret(d.private_key_enc, this.masterKey()),
        certificatePem: d.certificate_pem,
      },
      check,
    );
    await client.query(
      `INSERT INTO zatca_invoices
         (tenant_id, device_id, order_id, kind, uuid, icv, pih, invoice_no, invoice_hash, issue_at, xml, qr, signature, doc_input, return_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15)`,
      [tenantId, d.id, orderId, input.kind, doc.uuid, input.icv, doc.pih, input.invoice_no, doc.invoice_hash, input.issue_at, doc.xml, doc.qr, doc.signature, JSON.stringify(input), returnId],
    );
    await client.query(
      `UPDATE zatca_devices SET icv_last = $2, pih_last = $3, updated_at = now() WHERE id = $1`,
      [d.id, input.icv, doc.invoice_hash],
    );
  }

  /**
   * Credit note (381) against a sale's document, chained on the same device and referencing the
   * original. Two cases:
   *  - full cancellation (no `partial`): reproduces the whole original document negatively, once.
   *  - partial return (`partial` given): only the returned lines, idempotent per `partial.returnId`,
   *    so a sale can have several credit notes — one per return.
   * No-op when the sale never produced a document (ZATCA off / no device then).
   */
  async issueCreditNote(
    tenant: TenantContext,
    orderId: string,
    reason: string,
    partial?: {
      returnId: string;
      lines: { item_name: string; quantity: number }[];
      lineValueTotal: number;
      netAmount: number;
      taxAmount: number;
      refundTotal: number;
    },
  ): Promise<{ issued: boolean; reason?: string }> {
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const orig = await client.query(
        `SELECT device_id, invoice_no, doc_input FROM zatca_invoices
          WHERE tenant_id = $1 AND order_id = $2 AND kind = 'invoice' AND deleted_at IS NULL LIMIT 1`,
        [tenant.tenantId, orderId],
      );
      if (orig.rows.length === 0) return { issued: false, reason: 'no_document' };
      if (!orig.rows[0].doc_input) return { issued: false, reason: 'no_snapshot' };
      const existing = await client.query(
        partial
          ? `SELECT 1 FROM zatca_invoices WHERE tenant_id = $1 AND order_id = $2 AND kind = 'credit_note' AND return_id = $3 AND deleted_at IS NULL`
          : `SELECT 1 FROM zatca_invoices WHERE tenant_id = $1 AND order_id = $2 AND kind = 'credit_note' AND return_id IS NULL AND deleted_at IS NULL`,
        partial ? [tenant.tenantId, orderId, partial.returnId] : [tenant.tenantId, orderId],
      );
      if (existing.rows.length > 0) return { issued: false, reason: 'already_issued' };
      const dev = await client.query(
        `SELECT id, private_key_enc, certificate_pem, icv_last, pih_last FROM zatca_devices
          WHERE id = $1 AND deleted_at IS NULL AND certificate_pem IS NOT NULL AND private_key_enc IS NOT NULL FOR UPDATE`,
        [orig.rows[0].device_id],
      );
      if (dev.rows.length === 0) return { issued: false, reason: 'no_device' };
      const d = dev.rows[0];
      const base = orig.rows[0].doc_input as ZatcaDocInput;
      const refInvoiceNo = orig.rows[0].invoice_no as string;

      let input: ZatcaDocInput;
      let check: { orderTotal: number; orderTax: number } | undefined;
      if (partial) {
        // Build the returned lines on the original's own tax basis, and carry the prorated order
        // discount as a document allowance so the note's total equals the refund exactly.
        const unitByName = new Map(base.lines.map((l) => [l.name, l.unit_price]));
        const lines: ZatcaLine[] = partial.lines.map((rl) => {
          const unit = unitByName.get(rl.item_name);
          const total = unit !== undefined ? parseFloat((unit * rl.quantity).toFixed(2)) : parseFloat((partial.lineValueTotal / partial.lines.length).toFixed(2));
          return { name: rl.item_name, quantity: rl.quantity, unit_price: unit ?? total / rl.quantity, total };
        });
        const basis = base.tax_inclusive ? partial.refundTotal : partial.netAmount;
        const discount = parseFloat((partial.lineValueTotal - basis).toFixed(2));
        input = {
          ...base,
          kind: 'credit_note',
          invoice_no: `CN-${refInvoiceNo}-${partial.returnId.slice(0, 8)}`,
          uuid: randomUUID(),
          icv: Number(d.icv_last) + 1,
          pih: d.pih_last as string,
          issue_at: new Date(),
          lines,
          discount: discount > 0 ? discount : 0,
          reference_invoice_no: refInvoiceNo,
          reason,
        };
        check = { orderTotal: partial.refundTotal, orderTax: partial.taxAmount };
      } else {
        input = {
          ...base,
          kind: 'credit_note',
          invoice_no: `CN-${refInvoiceNo}`,
          uuid: randomUUID(),
          icv: Number(d.icv_last) + 1,
          pih: d.pih_last as string,
          issue_at: new Date(),
          reference_invoice_no: refInvoiceNo,
          reason,
        };
      }
      await this.storeDocument(client, d, tenant.tenantId, orderId, input, check, partial?.returnId ?? null);
      return { issued: true };
    });
  }

  // ---------------------------------------------------------------- device registry

  async createDevice(tenant: TenantContext, dto: CreateZatcaDeviceDto) {
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const branch = await client.query('SELECT id FROM branches WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [
        dto.branch_id,
        tenant.tenantId,
      ]);
      if (branch.rows.length === 0) throw new NotFoundException('Branch not found');
      const env = dto.env ?? 'sandbox';
      const egsSerial = `1-Sefay|2-${dto.egs_name.replace(/[|]/g, '-')}|3-${randomUUID()}`;
      try {
        const r = await client.query(
          `INSERT INTO zatca_devices (tenant_id, branch_id, env, egs_serial, seller)
           VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING ${DEVICE_PUBLIC_COLUMNS}`,
          [tenant.tenantId, dto.branch_id, env, egsSerial, JSON.stringify({ ...dto.seller, egs_name: dto.egs_name, business_category: dto.business_category })],
        );
        return r.rows[0];
      } catch (e) {
        if ((e as { code?: string }).code === '23505') {
          throw new BadRequestException('This branch already has a device for this environment');
        }
        throw e;
      }
    });
  }

  listDevices(tenant: TenantContext) {
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const r = await client.query(
        `SELECT ${DEVICE_PUBLIC_COLUMNS} FROM zatca_devices WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
        [tenant.tenantId],
      );
      return r.rows;
    });
  }

  /** Generates the device key pair (private key stored ENCRYPTED) and the CSR to send with the OTP. */
  async generateCsr(tenant: TenantContext, deviceId: string): Promise<{ csr_pem: string }> {
    const key = this.masterKey();
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const r = await client.query(
        `SELECT id, env, egs_serial, seller, certificate_pem FROM zatca_devices
          WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [deviceId, tenant.tenantId],
      );
      if (r.rows.length === 0) throw new NotFoundException('Device not found');
      const d = r.rows[0];
      if (d.certificate_pem) {
        throw new BadRequestException('This device already has a certificate; its key cannot be replaced');
      }
      const seller = d.seller as ZatcaSeller & { egs_name: string; business_category: string };
      const { privateKeyPem } = generateDeviceKeyPair();
      const branch = await client.query('SELECT name FROM branches WHERE id = (SELECT branch_id FROM zatca_devices WHERE id = $1)', [deviceId]);
      const csr = buildCsr(privateKeyPem, {
        env: d.env,
        organizationUnit: (branch.rows[0]?.name as string) ?? seller.legal_name,
        organization: seller.legal_name,
        commonName: seller.egs_name,
        egsSerial: d.egs_serial,
        vatNumber: seller.vat_number,
        invoiceTypes: '1100', // both standard (B2B) and simplified (POS) invoices
        address: `${seller.building_no} ${seller.street}, ${seller.district}, ${seller.city} ${seller.postal_zone}`,
        businessCategory: seller.business_category,
      });
      await client.query(
        `UPDATE zatca_devices SET private_key_enc = $2, csr_pem = $3, status = 'csr_ready', updated_at = now() WHERE id = $1`,
        [deviceId, encryptSecret(privateKeyPem, key), csr.pem],
      );
      return { csr_pem: csr.pem };
    });
  }

  /**
   * Stores the certificate ZATCA issued (Compliance or Production CSID). It must belong to this
   * device's key. The connection phase calls this automatically; until then it can be used to
   * import a certificate by hand.
   */
  async attachCertificate(tenant: TenantContext, deviceId: string, dto: AttachCertificateDto) {
    const key = this.masterKey();
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const r = await client.query(
        `SELECT id, private_key_enc FROM zatca_devices WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [deviceId, tenant.tenantId],
      );
      if (r.rows.length === 0) throw new NotFoundException('Device not found');
      if (!r.rows[0].private_key_enc) throw new BadRequestException('Generate the CSR first');
      let certKeyDer: Buffer;
      try {
        certKeyDer = new X509Certificate(dto.certificate_pem).publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
      } catch {
        throw new BadRequestException('certificate_pem is not a valid X.509 certificate');
      }
      const deviceKeyDer = createPublicKey(createPrivateKey(decryptSecret(r.rows[0].private_key_enc as string, key))).export({ type: 'spki', format: 'der' }) as Buffer;
      if (!certKeyDer.equals(deviceKeyDer)) {
        throw new BadRequestException('This certificate was not issued for this device key');
      }
      const status = dto.kind === 'production' ? 'active' : 'compliance';
      const u = await client.query(
        `UPDATE zatca_devices
            SET certificate_pem = $2, csid_kind = $3, csid_secret_enc = $4, status = $5, updated_at = now()
          WHERE id = $1 RETURNING ${DEVICE_PUBLIC_COLUMNS}`,
        [deviceId, dto.certificate_pem, dto.kind, dto.secret ? encryptSecret(dto.secret, key) : null, status],
      );
      return u.rows[0];
    });
  }

  // ---------------------------------------------------------------- onboarding (needs the connection)

  private fatoora(): FatooraGateway {
    if (!(this.gateway instanceof FatooraGateway)) {
      throw new BadRequestException('The ZATCA connection is not enabled (ZATCA_GATEWAY=fatoora)');
    }
    return this.gateway;
  }

  /** Step 1: exchange the CSR + the OTP from the Fatoora portal for the Compliance CSID. */
  async onboardCompliance(tenant: TenantContext, deviceId: string, otp: string) {
    const gw = this.fatoora();
    const key = this.masterKey();
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const r = await client.query(
        `SELECT env, csr_pem, certificate_pem FROM zatca_devices WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [deviceId, tenant.tenantId],
      );
      if (r.rows.length === 0) throw new NotFoundException('Device not found');
      if (!r.rows[0].csr_pem) throw new BadRequestException('Generate the CSR first');
      if (r.rows[0].certificate_pem) throw new BadRequestException('This device already has a certificate');
      const csid = await gw.requestComplianceCsid(r.rows[0].env, r.rows[0].csr_pem, otp);
      const u = await client.query(
        `UPDATE zatca_devices SET certificate_pem = $2, csid_kind = 'compliance', csid_secret_enc = $3,
                compliance_request_id = $4, status = 'compliance', updated_at = now()
          WHERE id = $1 RETURNING ${DEVICE_PUBLIC_COLUMNS}`,
        [deviceId, csid.certificatePem, encryptSecret(csid.secret, key), csid.requestId],
      );
      return u.rows[0];
    });
  }

  /** Step 2: sends a sample invoice, credit note and debit note; all must be accepted. */
  async runComplianceChecks(tenant: TenantContext, deviceId: string) {
    const gw = this.fatoora();
    const key = this.masterKey();
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const r = await client.query(
        `SELECT env, seller, private_key_enc, certificate_pem, csid_secret_enc, csid_kind FROM zatca_devices
          WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [deviceId, tenant.tenantId],
      );
      if (r.rows.length === 0) throw new NotFoundException('Device not found');
      const d = r.rows[0];
      if (d.csid_kind !== 'compliance' || !d.certificate_pem) throw new BadRequestException('Request the compliance CSID first');
      const creds = { privateKeyPem: decryptSecret(d.private_key_enc, key), certificatePem: d.certificate_pem };
      const secret = decryptSecret(d.csid_secret_enc, key);
      const results: { kind: string; ok: boolean; status: number; response: unknown }[] = [];
      let pih = ZATCA_FIRST_PIH;
      const kinds = ['invoice', 'credit_note', 'debit_note'] as const;
      for (let i = 0; i < kinds.length; i++) {
        const kind = kinds[i];
        const doc = generateSignedDocument(
          {
            kind,
            invoice_no: `SME${i + 1}`,
            uuid: randomUUID(),
            icv: i + 1,
            pih,
            issue_at: new Date(),
            currency: 'SAR',
            tax_rate: 0.15,
            tax_inclusive: false,
            lines: [{ name: 'Compliance check item', quantity: 1, unit_price: 100, total: 100 }],
            discount: 0,
            payment_code: '10',
            buyer: null,
            seller: d.seller as ZatcaSeller,
            ...(kind === 'invoice' ? {} : { reference_invoice_no: 'SME1', reason: 'compliance check' }),
          },
          creds,
        );
        pih = doc.invoice_hash;
        const res = await gw.complianceCheck(d.env, d.certificate_pem, secret, doc);
        results.push({ kind, ok: res.ok, status: res.status, response: res.response });
        if (!res.ok) break;
      }
      const passed = results.length === kinds.length && results.every((x) => x.ok);
      if (passed) {
        await client.query(`UPDATE zatca_devices SET compliance_checked_at = now(), updated_at = now() WHERE id = $1`, [deviceId]);
      }
      return { passed, results };
    });
  }

  /** Step 3: exchange the compliance request for the Production CSID; the device goes live. */
  async activateProduction(tenant: TenantContext, deviceId: string) {
    const gw = this.fatoora();
    const key = this.masterKey();
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const r = await client.query(
        `SELECT env, certificate_pem, csid_secret_enc, csid_kind, compliance_request_id, compliance_checked_at
           FROM zatca_devices WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [deviceId, tenant.tenantId],
      );
      if (r.rows.length === 0) throw new NotFoundException('Device not found');
      const d = r.rows[0];
      if (d.csid_kind !== 'compliance') throw new BadRequestException('Device is not in the compliance stage');
      if (!d.compliance_checked_at) throw new BadRequestException('Run and pass the compliance checks first');
      const csid = await gw.requestProductionCsid(d.env, d.certificate_pem, decryptSecret(d.csid_secret_enc, key), d.compliance_request_id);
      const u = await client.query(
        `UPDATE zatca_devices SET certificate_pem = $2, csid_kind = 'production', csid_secret_enc = $3, status = 'active', updated_at = now()
          WHERE id = $1 RETURNING ${DEVICE_PUBLIC_COLUMNS}`,
        [deviceId, csid.certificatePem, encryptSecret(csid.secret, key)],
      );
      return u.rows[0];
    });
  }

  listInvoices(tenant: TenantContext, status?: string) {
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const r = await client.query(
        `SELECT id, device_id, order_id, kind, uuid, icv, invoice_no, invoice_hash, issue_at, status, attempts, last_error, reported_at
           FROM zatca_invoices
          WHERE tenant_id = $1 AND deleted_at IS NULL AND ($2::text IS NULL OR status = $2)
          ORDER BY device_id, icv DESC LIMIT 200`,
        [tenant.tenantId, status ?? null],
      );
      return r.rows;
    });
  }

  // ---------------------------------------------------------------- sending queue

  /**
   * Sends waiting documents through the gateway, per device in ICV order, stopping at the first
   * one that does not go through (the chain must be delivered in order). With the no-op gateway
   * nothing is sent and nothing changes — that is the state until the connection is added.
   */
  async flushPending(tenant: TenantContext, limit = 50): Promise<{ gateway: string; sent: number; waiting: number }> {
    const key = this.masterKey();
    return this.tenantSession.runInTenantContext(tenant, async (client) => {
      const q = await client.query(
        `SELECT i.id, i.kind, i.uuid, i.icv, i.invoice_hash, i.xml, i.device_id, d.env, d.private_key_enc, d.certificate_pem, d.csid_secret_enc
           FROM zatca_invoices i JOIN zatca_devices d ON d.id = i.device_id
          WHERE i.tenant_id = $1 AND i.status IN ('pending', 'error') AND i.deleted_at IS NULL
          ORDER BY i.device_id, i.icv LIMIT $2 FOR UPDATE OF i`,
        [tenant.tenantId, limit],
      );
      let sent = 0;
      const blocked = new Set<string>();
      for (const row of q.rows) {
        if (blocked.has(row.device_id)) continue;
        const res = await this.gateway.submit(
          { id: row.id, kind: row.kind, uuid: row.uuid, icv: Number(row.icv), invoice_hash: row.invoice_hash, xml: row.xml },
          {
            id: row.device_id,
            env: row.env,
            credentials: {
              privateKeyPem: decryptSecret(row.private_key_enc, key),
              certificatePem: row.certificate_pem,
            },
            csidSecret: row.csid_secret_enc ? decryptSecret(row.csid_secret_enc, key) : null,
          },
        );
        if (res.status === 'pending') {
          blocked.add(row.device_id);
          continue;
        }
        await client.query(
          `UPDATE zatca_invoices
              SET status = $2, response = $3::jsonb, last_error = $4, attempts = attempts + 1,
                  reported_at = CASE WHEN $2 IN ('reported', 'cleared') THEN now() ELSE reported_at END, updated_at = now()
            WHERE id = $1`,
          [row.id, res.status, res.response === undefined ? null : JSON.stringify(res.response), res.error ?? null],
        );
        if (res.status === 'reported' || res.status === 'cleared') sent++;
        else blocked.add(row.device_id);
      }
      const waiting = await client.query(`SELECT count(*)::int AS n FROM zatca_invoices WHERE tenant_id = $1 AND status IN ('pending','error') AND deleted_at IS NULL`, [tenant.tenantId]);
      return { gateway: this.gateway.name, sent, waiting: waiting.rows[0].n as number };
    });
  }
}
