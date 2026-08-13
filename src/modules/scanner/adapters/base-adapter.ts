import { EventEmitter } from 'events';
import {
  AdapterDeviceType,
  AdapterError,
  AdapterState,
  IDeviceAdapter,
  ITransport,
  NormalizedDeviceEvent,
  ScannerCapability,
} from './adapter.types';

// Valid lifecycle transitions. Registration/initialization happen at
// construction (an adapter instance IS registered+initialized the moment
// it exists — there is no separate "not yet initialized" state worth
// modeling, since a TS class either constructs successfully or doesn't).
const VALID_TRANSITIONS: Record<AdapterState, AdapterState[]> = {
  registered: ['initialized'],
  initialized: ['connected', 'error'],
  connected: ['streaming', 'disconnected', 'error'],
  streaming: ['connected', 'disconnected', 'error'],
  error: ['initialized', 'disconnected'],
  disconnected: ['initialized'],
};

// Shared lifecycle + error-handling/recovery machinery for every adapter.
// Subclasses supply only what's genuinely hardware-specific: deviceType,
// capabilities(), and parseInput()'s framing rules. Contains zero business
// logic — no entity resolution, no inventory access, no workflow calls
// (enforced by omission: this class has no dependency capable of any of
// that).
export abstract class BaseAdapter implements IDeviceAdapter {
  abstract readonly deviceType: AdapterDeviceType;
  private _state: AdapterState = 'initialized';
  private readonly emitter = new EventEmitter();

  constructor(protected readonly transport: ITransport) {
    this.transport.onData((chunk) => this.handleRawChunk(chunk));
  }

  get state(): AdapterState {
    return this._state;
  }

  abstract capabilities(): ScannerCapability[];
  abstract parseInput(raw: string): string;

  async connect(): Promise<void> {
    try {
      await this.transport.open();
      this.transition('connected');
    } catch (error) {
      this.transition('error');
      throw new AdapterError(
        'CONNECTION_FAILED',
        `Failed to connect ${this.deviceType} adapter: ${(error as Error).message}`,
        true,
      );
    }
  }

  async disconnect(): Promise<void> {
    await this.transport.close();
    this.transition('disconnected');
  }

  healthCheck(): Promise<{
    healthy: boolean;
    state: AdapterState;
    detail?: string;
  }> {
    const open = this.transport.isOpen();
    const healthy =
      open && (this._state === 'connected' || this._state === 'streaming');
    return Promise.resolve({
      healthy,
      state: this._state,
      detail: healthy
        ? undefined
        : `transport.isOpen()=${open}, state=${this._state}`,
    });
  }

  // One reconnect attempt after a recoverable error (e.g. a dropped
  // connection). Not automatic/looping — a client runtime decides its own
  // retry/backoff policy around this single-shot primitive.
  async recover(): Promise<void> {
    if (this._state !== 'error') {
      throw new AdapterError(
        'INVALID_STATE_TRANSITION',
        'recover() is only valid from the error state',
      );
    }
    this.transition('initialized');
    await this.connect();
  }

  normalizeOutput(
    parsed: string,
    meta: Record<string, unknown> = {},
  ): NormalizedDeviceEvent {
    if (!parsed) {
      throw new AdapterError(
        'PARSE_ERROR',
        'Cannot normalize an empty parsed value',
      );
    }
    return {
      raw_value: parsed,
      scan_type: this.defaultScanType(),
      source: this.deviceType,
      timestamp: new Date().toISOString(),
      metadata: meta,
    };
  }

  onScan(handler: (event: NormalizedDeviceEvent) => void): void {
    this.emitter.on('scan', handler);
  }

  protected defaultScanType(): 'barcode' | 'rfid' | 'manual' {
    return this.capabilities().includes('rfid') ? 'rfid' : 'barcode';
  }

  private handleRawChunk(chunk: string): void {
    if (this._state !== 'connected' && this._state !== 'streaming') return;
    const wasConnected = this._state === 'connected';
    if (wasConnected) this.transition('streaming');
    try {
      const parsed = this.parseInput(chunk);
      const event = this.normalizeOutput(parsed);
      this.emitter.emit('scan', event);
    } catch {
      // A single malformed chunk does not tear down the connection — the
      // adapter stays connected/streaming and simply drops that one
      // chunk. Only transport-level failures (connect()/disconnect())
      // move the lifecycle state; a parse failure is not a connection
      // problem.
    } finally {
      if (this._state === 'streaming') this.transition('connected');
    }
  }

  private transition(next: AdapterState): void {
    const allowed = VALID_TRANSITIONS[this._state];
    if (!allowed.includes(next)) {
      throw new AdapterError(
        'INVALID_STATE_TRANSITION',
        `Cannot transition ${this.deviceType} adapter from "${this._state}" to "${next}"`,
      );
    }
    this._state = next;
  }
}
