import type { ZatcaDeviceCredentials, ZatcaEnv } from './zatca.types';

// The ONLY part of the ZATCA integration that talks to the Authority. Everything else (document
// generation, signing, hash chain, storage, queue) is complete and does not change when the
// connection is added: connecting later means writing one class that implements this interface
// (Compliance/Production CSID requests, Reporting and Clearance calls) and binding it to
// ZATCA_GATEWAY instead of the no-op gateway below.

export interface GatewayDocument {
  id: string;
  kind: 'invoice' | 'credit_note' | 'debit_note';
  uuid: string;
  icv: number;
  invoice_hash: string;
  /** The signed XML exactly as stored. */
  xml: string;
}

export interface GatewayDevice {
  id: string;
  env: ZatcaEnv;
  credentials: ZatcaDeviceCredentials;
  /** Basic-auth secret issued together with the CSID, when present. */
  csidSecret: string | null;
}

export interface GatewayResult {
  /** pending: not sent (no connection / retry later); reported or cleared: accepted; rejected: refused; error: transient failure. */
  status: 'pending' | 'reported' | 'cleared' | 'rejected' | 'error';
  response?: unknown;
  error?: string;
}

export interface ZatcaGateway {
  readonly name: string;
  submit(doc: GatewayDocument, device: GatewayDevice): Promise<GatewayResult>;
}

export const ZATCA_GATEWAY = Symbol('ZATCA_GATEWAY');

/** Until the connection exists: nothing is sent, documents simply wait as `pending`. */
export class NullZatcaGateway implements ZatcaGateway {
  readonly name = 'null';
  submit(): Promise<GatewayResult> {
    return Promise.resolve({ status: 'pending' });
  }
}
