import { BaseAdapter } from './base-adapter';
import {
  AdapterDeviceType,
  NormalizedDeviceEvent,
  ScannerCapability,
} from './adapter.types';

// RFID readers commonly report the tag's EPC as a hex string, sometimes
// wrapped in reader-specific framing bytes (STX/ETX or a trailing
// checksum byte) around the hex payload. This adapter extracts the
// longest contiguous hex run rather than assuming a fixed frame length,
// since frame conventions vary by reader model.
const HEX_RUN_PATTERN = /[0-9A-Fa-f]{8,}/;

export class RfidAdapter extends BaseAdapter {
  readonly deviceType: AdapterDeviceType = 'rfid';

  capabilities(): ScannerCapability[] {
    return ['rfid'];
  }

  parseInput(raw: string): string {
    const match = HEX_RUN_PATTERN.exec(raw);
    if (!match) {
      throw new Error('No hex EPC payload found in RFID input');
    }
    return match[0].toUpperCase();
  }

  normalizeOutput(
    parsed: string,
    meta: Record<string, unknown> = {},
  ): NormalizedDeviceEvent {
    return super.normalizeOutput(parsed, { ...meta, epc: parsed });
  }
}
