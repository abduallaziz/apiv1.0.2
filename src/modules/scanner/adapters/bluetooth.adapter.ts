import { BaseAdapter } from './base-adapter';
import { AdapterDeviceType, ScannerCapability } from './adapter.types';

// Many Bluetooth SPP scanners frame each scan with STX (0x02) / ETX (0x03)
// control characters around the payload, in addition to a trailing
// terminator like a plain HID scanner. Strip both.
const STX = '\x02';
const ETX = '\x03';

export class BluetoothAdapter extends BaseAdapter {
  readonly deviceType: AdapterDeviceType = 'bluetooth';

  capabilities(): ScannerCapability[] {
    return ['barcode_1d', 'barcode_2d', 'bluetooth'];
  }

  parseInput(raw: string): string {
    let value = raw.replace(/[\r\n\t]+$/g, '').trim();
    if (value.startsWith(STX)) value = value.slice(1);
    if (value.endsWith(ETX)) value = value.slice(0, -1);
    return value.trim();
  }
}
