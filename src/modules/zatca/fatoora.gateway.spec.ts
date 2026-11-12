import { FatooraGateway, basicAuth, type FetchLike } from './fatoora.gateway';
import { certBase64, generateDeviceKeyPair } from './zatca-crypto.util';
import { makeTestCertificate } from './testing/test-cert';

const { privateKeyPem } = generateDeviceKeyPair();
const cert = makeTestCertificate(privateKeyPem);

function fake(status: number, body: unknown) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    return { status, text: async () => JSON.stringify(body) };
  };
  return { f, calls };
}

const doc = { id: 'i', kind: 'invoice' as const, uuid: 'u1', icv: 1, invoice_hash: 'HASH', xml: '<Invoice><cbc:InvoiceTypeCode name="0200000">388</cbc:InvoiceTypeCode></Invoice>' };
const device = (env: 'sandbox' | 'simulation' | 'production' = 'simulation', secret: string | null = 'sec') => ({
  id: 'd',
  env,
  credentials: { privateKeyPem, certificatePem: cert.certificatePem },
  csidSecret: secret,
});

describe('FatooraGateway', () => {
  it('basic auth is base64(base64(cert):secret)', () => {
    const h = basicAuth(cert.certificatePem, 'sec');
    const decoded = Buffer.from(h.replace('Basic ', ''), 'base64').toString();
    const [user, secret] = decoded.split(':');
    expect(secret).toBe('sec');
    expect(Buffer.from(user, 'base64').toString()).toBe(certBase64(cert.certificatePem));
  });

  it('compliance CSID: sends the OTP and the base64 CSR, returns the certificate as PEM', async () => {
    const token = Buffer.from(certBase64(cert.certificatePem)).toString('base64');
    const { f, calls } = fake(200, { requestID: 123, binarySecurityToken: token, secret: 's3', dispositionMessage: 'ISSUED' });
    const r = await new FatooraGateway(f).requestComplianceCsid('simulation', 'CSR-PEM', '123456');
    expect(calls[0].url).toBe('https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/compliance');
    expect(calls[0].headers.OTP).toBe('123456');
    expect(calls[0].headers['Accept-Version']).toBe('V2');
    expect(Buffer.from(calls[0].body.csr, 'base64').toString()).toBe('CSR-PEM');
    expect(r.requestId).toBe('123');
    expect(r.secret).toBe('s3');
    expect(certBase64(r.certificatePem)).toBe(certBase64(cert.certificatePem));
  });

  it('a refused CSID request throws with the Authority text', async () => {
    const { f } = fake(400, { message: 'Invalid OTP' });
    await expect(new FatooraGateway(f).requestComplianceCsid('production', 'x', '000000')).rejects.toThrow(/Invalid OTP/);
  });

  it('production CSID uses the compliance credentials and request id', async () => {
    const token = Buffer.from(certBase64(cert.certificatePem)).toString('base64');
    const { f, calls } = fake(200, { requestID: 9, binarySecurityToken: token, secret: 'p' });
    await new FatooraGateway(f).requestProductionCsid('production', cert.certificatePem, 'sec', '123');
    expect(calls[0].url).toBe('https://gw-fatoora.zatca.gov.sa/e-invoicing/core/production/csids');
    expect(calls[0].body).toEqual({ compliance_request_id: '123' });
    expect(calls[0].headers.Authorization).toBe(basicAuth(cert.certificatePem, 'sec'));
  });

  it('reports a simplified document: right endpoint, payload and status mapping', async () => {
    const ok = fake(200, { reportingStatus: 'REPORTED' });
    const g = new FatooraGateway(ok.f);
    expect((await g.submit(doc, device('sandbox'))).status).toBe('reported');
    expect(ok.calls[0].url).toBe('https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/invoices/reporting/single');
    expect(ok.calls[0].headers['Clearance-Status']).toBe('0');
    expect(ok.calls[0].body).toEqual({ invoiceHash: 'HASH', uuid: 'u1', invoice: Buffer.from(doc.xml).toString('base64') });

    expect((await new FatooraGateway(fake(202, {}).f).submit(doc, device())).status).toBe('reported'); // accepted with warnings
    expect((await new FatooraGateway(fake(409, {}).f).submit(doc, device())).status).toBe('reported'); // already there
    expect((await new FatooraGateway(fake(400, {}).f).submit(doc, device())).status).toBe('rejected');
    expect((await new FatooraGateway(fake(503, {}).f).submit(doc, device())).status).toBe('error');
  });

  it('standard documents go to clearance; no secret means it waits', async () => {
    const std = { ...doc, xml: doc.xml.replace('0200000', '0100000') };
    const c = fake(200, {});
    expect((await new FatooraGateway(c.f).submit(std, device('production'))).status).toBe('cleared');
    expect(c.calls[0].url).toContain('/core/invoices/clearance/single');
    expect(c.calls[0].headers['Clearance-Status']).toBe('1');
    expect((await new FatooraGateway(c.f).submit(doc, device('production', null))).status).toBe('pending');
  });

  it('a network failure is a retryable error, never a rejection', async () => {
    const boom: FetchLike = async () => {
      throw new Error('ECONNRESET');
    };
    const r = await new FatooraGateway(boom).submit(doc, device());
    expect(r.status).toBe('error');
  });
});
