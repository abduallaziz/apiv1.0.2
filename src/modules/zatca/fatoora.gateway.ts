import { certBase64 } from './zatca-crypto.util';
import type { GatewayDevice, GatewayDocument, GatewayResult, ZatcaGateway } from './zatca.gateway';
import type { ZatcaEnv } from './zatca.types';

// The real connection to ZATCA's Fatoora platform (developer portal / simulation / production).
// Endpoints, headers and payloads follow the Fatoora portal user manual and the technical guideline.
// Nothing here is exercised against the live Authority until the owner supplies a VAT registration,
// an OTP and the environment; the logic is unit-tested against a fake HTTP layer.

const BASE = 'https://gw-fatoora.zatca.gov.sa/e-invoicing';
const PATH: Record<ZatcaEnv, string> = { sandbox: 'developer-portal', simulation: 'simulation', production: 'core' };

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface CsidResponse {
  requestId: string;
  /** PEM of the issued certificate. */
  certificatePem: string;
  secret: string;
  message?: string;
}

export function basicAuth(certificatePem: string, secret: string): string {
  const user = Buffer.from(certBase64(certificatePem), 'utf8').toString('base64');
  return `Basic ${Buffer.from(`${user}:${secret}`, 'utf8').toString('base64')}`;
}

function pemFromToken(binarySecurityToken: string): string {
  // The token is the base64 of the certificate's own base64 text.
  const b64 = Buffer.from(binarySecurityToken, 'base64').toString('utf8').trim();
  return `-----BEGIN CERTIFICATE-----\n${(b64.match(/.{1,64}/g) ?? []).join('\n')}\n-----END CERTIFICATE-----\n`;
}

export class FatooraGateway implements ZatcaGateway {
  readonly name = 'fatoora';

  constructor(private readonly doFetch: FetchLike = (url, init) => fetch(url, init as RequestInit)) {}

  private url(env: ZatcaEnv, path: string): string {
    return `${BASE}/${PATH[env]}${path}`;
  }

  private async call(url: string, headers: Record<string, string>, body: unknown) {
    const res = await this.doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Version': 'V2', 'Accept-Language': 'en', ...headers },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let json: unknown = raw;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      /* keep raw text */
    }
    return { status: res.status, json };
  }

  // ------------------------------------------------------------------ onboarding

  /** Step 1: Compliance CSID from the CSR and the OTP generated in the Fatoora portal. */
  async requestComplianceCsid(env: ZatcaEnv, csrPem: string, otp: string): Promise<CsidResponse> {
    const r = await this.call(this.url(env, '/compliance'), { OTP: otp }, { csr: Buffer.from(csrPem, 'utf8').toString('base64') });
    return this.csidOrThrow(r, 'compliance CSID');
  }

  /** Step 2: one compliance check document (the Authority validates it without recording it). */
  async complianceCheck(env: ZatcaEnv, certificatePem: string, secret: string, doc: Pick<GatewayDocument, 'invoice_hash' | 'uuid' | 'xml'>) {
    const r = await this.call(
      this.url(env, '/compliance/invoices'),
      { Authorization: basicAuth(certificatePem, secret) },
      { invoiceHash: doc.invoice_hash, uuid: doc.uuid, invoice: Buffer.from(doc.xml, 'utf8').toString('base64') },
    );
    return { ok: r.status === 200 || r.status === 202, status: r.status, response: r.json };
  }

  /** Step 3: Production CSID, exchanged for the compliance request id. */
  async requestProductionCsid(env: ZatcaEnv, complianceCertPem: string, complianceSecret: string, complianceRequestId: string): Promise<CsidResponse> {
    const r = await this.call(
      this.url(env, '/production/csids'),
      { Authorization: basicAuth(complianceCertPem, complianceSecret) },
      { compliance_request_id: complianceRequestId },
    );
    return this.csidOrThrow(r, 'production CSID');
  }

  private csidOrThrow(r: { status: number; json: any }, what: string): CsidResponse {
    if (r.status !== 200 || !r.json?.binarySecurityToken) {
      const detail = typeof r.json === 'string' ? r.json : JSON.stringify(r.json);
      throw new Error(`ZATCA refused the ${what} request (HTTP ${r.status}): ${detail}`);
    }
    return {
      requestId: String(r.json.requestID),
      certificatePem: pemFromToken(r.json.binarySecurityToken),
      secret: String(r.json.secret),
      message: r.json.dispositionMessage,
    };
  }

  // ------------------------------------------------------------------ reporting / clearance

  /**
   * Simplified invoices (and their notes) are REPORTED; the standard ones would be CLEARED. The
   * document type is read from the invoice's own type code name (0100000 standard / 0200000 simplified).
   */
  async submit(doc: GatewayDocument, device: GatewayDevice): Promise<GatewayResult> {
    if (!device.csidSecret) return { status: 'pending', error: 'device has no CSID secret yet' };

    // The developer-portal sandbox only exposes the compliance-check endpoint (no reporting /
    // clearance). There, "sending" a document means validating it — a PASS counts as reported, so the
    // demo queue works end-to-end and keeps proving our documents are ZATCA-valid, with no real data.
    if (device.env === 'sandbox') {
      const c = await this.complianceCheck(device.env, device.credentials.certificatePem, device.csidSecret, doc);
      const status = (c.response as any)?.validationResults?.status;
      if (c.ok && status === 'PASS') return { status: 'reported', response: c.response };
      if (status === 'ERROR') return { status: 'rejected', response: c.response, error: 'sandbox validation failed' };
      return { status: 'error', response: c.response, error: `sandbox HTTP ${c.status}` };
    }

    const clearance = /<cbc:InvoiceTypeCode name="01/.test(doc.xml);
    let r: { status: number; json: any };
    try {
      r = await this.call(
        this.url(device.env, clearance ? '/invoices/clearance/single' : '/invoices/reporting/single'),
        {
          Authorization: basicAuth(device.credentials.certificatePem, device.csidSecret),
          'Clearance-Status': clearance ? '1' : '0',
        },
        { invoiceHash: doc.invoice_hash, uuid: doc.uuid, invoice: Buffer.from(doc.xml, 'utf8').toString('base64') },
      );
    } catch (e) {
      return { status: 'error', error: `network: ${(e as Error).message}` };
    }
    if (r.status === 200 || r.status === 202) {
      return { status: clearance ? 'cleared' : 'reported', response: r.json };
    }
    // 400 = the document itself is refused; 401/403 = credentials; 409 = already submitted; 5xx = try later
    if (r.status === 409) return { status: clearance ? 'cleared' : 'reported', response: r.json };
    if (r.status === 400) return { status: 'rejected', response: r.json, error: 'rejected by ZATCA' };
    return { status: 'error', response: r.json, error: `HTTP ${r.status}` };
  }
}
