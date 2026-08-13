import { BaseAdapter } from './base-adapter';
import { AdapterDeviceType, ScannerCapability } from './adapter.types';

// A USB HID scanner in keyboard-wedge mode types the barcode followed by
// an Enter keystroke (CR and/or LF) into whatever has focus. The client
// transport (WebHID or a keydown listener) hands us that raw text
// including the terminator; parseInput strips it.
export class UsbHidAdapter extends BaseAdapter {
  readonly deviceType: AdapterDeviceType = 'usb_hid';

  capabilities(): ScannerCapability[] {
    return ['barcode_1d', 'barcode_2d'];
  }

  parseInput(raw: string): string {
    return raw.replace(/[\r\n\t]+$/g, '').trim();
  }
}
