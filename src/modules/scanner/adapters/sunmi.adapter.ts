import { BaseAdapter } from './base-adapter';
import { AdapterDeviceType, ScannerCapability } from './adapter.types';

// Sunmi POS terminals expose their built-in scan engine through a native
// Android broadcast/API that already delivers a decoded string — same
// situation as CameraAdapter, no wire-level framing to strip here.
export class SunmiAdapter extends BaseAdapter {
  readonly deviceType: AdapterDeviceType = 'sunmi';

  capabilities(): ScannerCapability[] {
    return ['barcode_1d', 'barcode_2d'];
  }

  parseInput(raw: string): string {
    return raw.trim();
  }
}
