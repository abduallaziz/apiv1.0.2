import { BaseAdapter } from './base-adapter';
import {
  AdapterDeviceType,
  NormalizedDeviceEvent,
  ScannerCapability,
} from './adapter.types';
import { stripAimPrefix } from './utils/aim-symbology.util';

export class ZebraAdapter extends BaseAdapter {
  readonly deviceType: AdapterDeviceType = 'zebra';
  private lastSymbology: string | null = null;

  capabilities(): ScannerCapability[] {
    return ['barcode_1d', 'barcode_2d'];
  }

  parseInput(raw: string): string {
    const trimmed = raw.replace(/[\r\n\t]+$/g, '').trim();
    const { value, symbology } = stripAimPrefix(trimmed);
    this.lastSymbology = symbology;
    return value.trim();
  }

  normalizeOutput(
    parsed: string,
    meta: Record<string, unknown> = {},
  ): NormalizedDeviceEvent {
    return super.normalizeOutput(parsed, {
      ...meta,
      ...(this.lastSymbology ? { aim_symbology: this.lastSymbology } : {}),
    });
  }
}
