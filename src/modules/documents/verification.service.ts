import { randomBytes } from 'crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

// Public document verification (Phase 9). A QR on an issued document points to
// /public/verify/:token; that page is VIEW/VERIFY ONLY (no actions) and shows nothing but the
// whitelisted fields the issuer chose to expose.

/** The only keys that may ever be exposed publicly. */
export const PUBLIC_FIELD_KEYS = [
  'document_number',
  'document_date',
  'issuer_name',
  'issuer_vat_number',
  'total',
] as const;

const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

export function newVerificationToken(): string {
  return randomBytes(24).toString('base64url'); // 192 bits -> 32 chars
}

/** Keeps whitelisted keys with short string values; everything else is dropped. */
export function pickPublicFields(
  input: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of PUBLIC_FIELD_KEYS) {
    const v = input[k];
    if (typeof v === 'string' && v.length > 0 && v.length <= 200) out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v.toFixed(2);
  }
  return out;
}

interface TokenRow {
  public_fields: Record<string, unknown>;
  expires_at: string | null;
  generated_documents: {
    doc_type: string;
    status: string;
    issued_at: string;
    deleted_at: string | null;
  } | null;
}

@Injectable()
export class VerificationService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  /** Called inside the issuing transaction (Phase 10), so a document and its token commit together. */
  async createToken(
    client: PoolClient,
    tenantId: string,
    generatedDocumentId: string,
    fields: Record<string, unknown>,
    expiresAt?: Date | null,
    presetToken?: string,
  ): Promise<string> {
    // a preset token lets the issuing flow put the verify URL in the QR BEFORE the row is inserted
    if (presetToken !== undefined && !/^[A-Za-z0-9_-]{32}$/.test(presetToken)) {
      throw new Error('Invalid verification token');
    }
    const token = presetToken ?? newVerificationToken();
    await client.query(
      `INSERT INTO document_verification_tokens
         (tenant_id, generated_document_id, token, public_fields, expires_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        tenantId,
        generatedDocumentId,
        token,
        JSON.stringify(pickPublicFields(fields)),
        expiresAt ?? null,
      ],
    );
    return token;
  }

  async verify(token: string) {
    // every failure looks the same: nothing reveals whether a token ever existed
    if (!TOKEN_RE.test(token)) throw new NotFoundException('Not found');
    const { data, error } = await this.supabase
      .from('document_verification_tokens')
      .select(
        'public_fields, expires_at, generated_documents(doc_type, status, issued_at, deleted_at)',
      )
      .eq('token', token)
      .is('deleted_at', null)
      .maybeSingle();
    const row = data as unknown as TokenRow | null;
    if (error || !row || !row.generated_documents) {
      throw new NotFoundException('Not found');
    }
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      throw new NotFoundException('Not found');
    }
    const doc = row.generated_documents;
    if (doc.deleted_at) throw new NotFoundException('Not found');
    return {
      valid: doc.status === 'issued',
      status: doc.status,
      doc_type: doc.doc_type,
      issued_at: doc.issued_at,
      fields: pickPublicFields(row.public_fields),
    };
  }
}
