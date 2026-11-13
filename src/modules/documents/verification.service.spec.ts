import { NotFoundException } from '@nestjs/common';
import {
  PUBLIC_FIELD_KEYS,
  VerificationService,
  newVerificationToken,
  pickPublicFields,
} from './verification.service';

const TOKEN = 'A'.repeat(32);

function service(result: { data: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.is = () => chain;
  chain.maybeSingle = () => Promise.resolve({ error: null, ...result });
  const supabase = { from: () => chain };
  return new VerificationService(supabase as never);
}

const doc = (over: Record<string, unknown> = {}) => ({
  doc_type: 'quotation',
  status: 'issued',
  issued_at: '2026-01-01',
  deleted_at: null,
  ...over,
});

const row = (over: Record<string, unknown> = {}) => ({
  public_fields: {
    document_number: 'QT-1',
    issuer_name: 'Acme',
    secret: 'LEAK',
    customer_name: 'LEAK',
  },
  expires_at: null,
  generated_documents: doc(),
  ...over,
});

describe('VerificationService', () => {
  it('tokens are 32 url-safe chars and unique', () => {
    const a = newVerificationToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(newVerificationToken()).not.toBe(a);
  });

  it('exposes ONLY whitelisted fields', () => {
    expect(
      pickPublicFields({
        document_number: 'X',
        customer_name: 'LEAK',
        total: 12.5,
        evil: '<s>',
      }),
    ).toEqual({ document_number: 'X', total: '12.50' });
    expect(PUBLIC_FIELD_KEYS).not.toContain('customer_name' as never);
  });

  it('verifies an issued document without leaking anything else', async () => {
    const r = await service({ data: row() }).verify(TOKEN);
    expect(r).toEqual({
      valid: true,
      status: 'issued',
      doc_type: 'quotation',
      issued_at: '2026-01-01',
      fields: { document_number: 'QT-1', issuer_name: 'Acme' },
    });
    expect(JSON.stringify(r)).not.toContain('LEAK');
  });

  it('a voided document verifies as NOT valid', async () => {
    const r = await service({
      data: row({ generated_documents: doc({ status: 'void' }) }),
    }).verify(TOKEN);
    expect(r.valid).toBe(false);
  });

  it.each([
    ['unknown token', { data: null }],
    ['expired token', { data: row({ expires_at: '2000-01-01T00:00:00Z' }) }],
    [
      'deleted document',
      {
        data: row({
          generated_documents: doc({ deleted_at: '2026-01-01' }),
        }),
      },
    ],
    ['db error', { data: null, error: { message: 'boom' } }],
  ])('%s -> identical 404', async (_n, result) => {
    await expect(service(result).verify(TOKEN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects malformed tokens before any database call', async () => {
    const from = jest.fn();
    const svc = new VerificationService({ from } as never);
    for (const bad of [
      'short',
      'x'.repeat(33),
      "' OR 1=1 --",
      '../etc/passwd',
      'A'.repeat(31) + '!',
    ]) {
      await expect(svc.verify(bad)).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(from).not.toHaveBeenCalled();
  });
});
