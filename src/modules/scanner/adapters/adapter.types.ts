// Adapter Framework (#21 Phase 6) — shared contracts.
//
// Critical architecture note, decided during this phase's design review:
// USB/Bluetooth/Camera/RFID hardware is physically attached to whatever
// device the warehouse worker is holding — a browser tab (WebHID/
// WebBluetooth/getUserMedia) or the future Mobile Scanner App (Phase 8).
// It is never attached to this Node.js backend process. So "connect to
// hardware" cannot mean "the server opens a USB socket" — that hardware
// doesn't exist from the server's vantage point. Instead, every adapter is
// built against an injected ITransport: production transports (browser
// WebHID/WebBluetooth wrappers, native Android Sunmi/Zebra/Honeywell SDKs)
// are supplied by whatever client runtime actually touches the hardware;
// this backend module defines the CONTRACT + the hardware-format parsing/
// normalization logic (which genuinely is shared, portable TypeScript),
// and ships a MockTransport for testing that contract end-to-end without
// physical hardware. This is not a stub standing in for unfinished work —
// it is the correct topology for a cloud SaaS backend.

export type ScannerCapability =
  | 'barcode_1d'
  | 'barcode_2d'
  | 'rfid'
  | 'camera'
  | 'bluetooth';

export type AdapterDeviceType =
  | 'usb_hid'
  | 'bluetooth'
  | 'camera'
  | 'zebra'
  | 'honeywell'
  | 'sunmi'
  | 'rfid';

export type AdapterState =
  | 'registered'
  | 'initialized'
  | 'connected'
  | 'streaming'
  | 'error'
  | 'disconnected';

export type AdapterScanType = 'barcode' | 'rfid' | 'manual';

// What the Scanner Event Engine (Phase 4) accepts as CreateScanEventDto —
// an adapter's job ends the moment it can produce this shape. Deliberately
// the same field set, not a parallel one, so wiring an adapter's output
// into POST /scanner/events is a direct pass-through, not a translation
// layer of its own.
export interface NormalizedDeviceEvent {
  raw_value: string;
  scan_type: AdapterScanType;
  source: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export type AdapterErrorCode =
  | 'CONNECTION_FAILED'
  | 'NOT_CONNECTED'
  | 'PARSE_ERROR'
  | 'UNSUPPORTED_INPUT'
  | 'DEVICE_TIMEOUT'
  | 'INVALID_STATE_TRANSITION';

export class AdapterError extends Error {
  constructor(
    public readonly code: AdapterErrorCode,
    message: string,
    // Whether BaseAdapter.recover() should attempt a reconnect. Parse
    // errors on a single scan are not connection problems and are not
    // recoverable via reconnect; connection failures are.
    public readonly recoverable: boolean = false,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

// Hardware transport abstraction — implemented by the client runtime that
// actually owns the physical connection. No implementation of this
// interface lives in this backend for production use; only MockTransport
// (test-only) does.
export interface ITransport {
  open(): Promise<void>;
  close(): Promise<void>;
  isOpen(): boolean;
  onData(handler: (chunk: string) => void): void;
}

export interface IDeviceAdapter {
  readonly deviceType: AdapterDeviceType;
  readonly state: AdapterState;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<{
    healthy: boolean;
    state: AdapterState;
    detail?: string;
  }>;
  capabilities(): ScannerCapability[];
  // Strips hardware-specific framing (terminators, AIM symbology
  // prefixes, control bytes) from a raw chunk, returning the meaningful
  // scan payload. Never resolves it to an entity — that is the Resolver
  // Engine's job (Phase 5), operating on the Scanner Event Engine's
  // normalized_value, not on adapter output directly.
  parseInput(raw: string): string;
  normalizeOutput(
    parsed: string,
    meta?: Record<string, unknown>,
  ): NormalizedDeviceEvent;
  onScan(handler: (event: NormalizedDeviceEvent) => void): void;
}
