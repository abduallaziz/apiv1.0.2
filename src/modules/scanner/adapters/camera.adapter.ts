import { BaseAdapter } from './base-adapter';
import { AdapterDeviceType, ScannerCapability } from './adapter.types';

// A camera "scanner" is really a client-side barcode-decoding library
// (e.g. a ZXing/BarcodeDetector wrapper) reading frames from getUserMedia
// — by the time its output reaches this adapter it is already a decoded
// string, not raw bytes. parseInput has nothing hardware-specific to
// strip; it only guards against decoder noise (empty/whitespace frames).
export class CameraAdapter extends BaseAdapter {
  readonly deviceType: AdapterDeviceType = 'camera';

  capabilities(): ScannerCapability[] {
    return ['barcode_1d', 'barcode_2d', 'camera'];
  }

  parseInput(raw: string): string {
    return raw.trim();
  }
}
