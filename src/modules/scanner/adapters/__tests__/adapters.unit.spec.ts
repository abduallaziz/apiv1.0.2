import { UsbHidAdapter } from '../usb-hid.adapter';
import { BluetoothAdapter } from '../bluetooth.adapter';
import { CameraAdapter } from '../camera.adapter';
import { ZebraAdapter } from '../zebra.adapter';
import { HoneywellAdapter } from '../honeywell.adapter';
import { SunmiAdapter } from '../sunmi.adapter';
import { RfidAdapter } from '../rfid.adapter';
import { MockTransport } from './mock-transport';
import {
  listAdapterDescriptors,
  getAdapterDescriptor,
} from '../adapter-registry';
import { createAdapter } from '../adapter-factory';
import { AdapterError } from '../adapter.types';

describe('UsbHidAdapter.parseInput', () => {
  it('strips a trailing Enter-key terminator', () => {
    const adapter = new UsbHidAdapter(new MockTransport());
    expect(adapter.parseInput('1234567890\r\n')).toBe('1234567890');
    expect(adapter.parseInput('ABC123\n')).toBe('ABC123');
  });
});

describe('BluetoothAdapter.parseInput', () => {
  it('strips STX/ETX framing and trailing terminator', () => {
    const adapter = new BluetoothAdapter(new MockTransport());
    expect(adapter.parseInput('\x02987654321\x03\r\n')).toBe('987654321');
  });

  it('handles input with no framing the same as plain HID', () => {
    const adapter = new BluetoothAdapter(new MockTransport());
    expect(adapter.parseInput('987654321\r\n')).toBe('987654321');
  });
});

describe('CameraAdapter.parseInput', () => {
  it('trims decoder whitespace noise without altering the payload', () => {
    const adapter = new CameraAdapter(new MockTransport());
    expect(adapter.parseInput('  QR-CODE-VALUE  ')).toBe('QR-CODE-VALUE');
  });
});

describe('ZebraAdapter.parseInput', () => {
  it('strips a 3-character AIM symbology prefix', () => {
    const adapter = new ZebraAdapter(new MockTransport());
    expect(adapter.parseInput(']C1123456789\r\n')).toBe('123456789');
  });

  it('records the detected symbology in normalizeOutput metadata', () => {
    const adapter = new ZebraAdapter(new MockTransport());
    const parsed = adapter.parseInput(']E0987654321012\r\n');
    const event = adapter.normalizeOutput(parsed);
    expect(event.metadata.aim_symbology).toBe(']E0');
  });

  it('passes input through unchanged when no AIM prefix is present', () => {
    const adapter = new ZebraAdapter(new MockTransport());
    expect(adapter.parseInput('987654321\r\n')).toBe('987654321');
  });
});

describe('HoneywellAdapter.parseInput', () => {
  it('strips a 3-character AIM symbology prefix', () => {
    const adapter = new HoneywellAdapter(new MockTransport());
    expect(adapter.parseInput(']d2PDF417PAYLOAD\r\n')).toBe('PDF417PAYLOAD');
  });
});

describe('SunmiAdapter.parseInput', () => {
  it('trims decoded string with no wire framing to strip', () => {
    const adapter = new SunmiAdapter(new MockTransport());
    expect(adapter.parseInput('  123456  ')).toBe('123456');
  });
});

describe('RfidAdapter.parseInput', () => {
  it('extracts the hex EPC run and uppercases it', () => {
    const adapter = new RfidAdapter(new MockTransport());
    expect(adapter.parseInput('\x02e2003412012345670000abcd\x03')).toBe(
      'E2003412012345670000ABCD',
    );
  });

  it('throws PARSE_ERROR-eligible error for input with no hex payload', () => {
    const adapter = new RfidAdapter(new MockTransport());
    expect(() => adapter.parseInput('no hex here')).toThrow();
  });

  it('includes the epc value in normalizeOutput metadata', () => {
    const adapter = new RfidAdapter(new MockTransport());
    const parsed = adapter.parseInput('e2003412012345670000abcd');
    const event = adapter.normalizeOutput(parsed);
    expect(event.metadata.epc).toBe('E2003412012345670000ABCD');
    expect(event.scan_type).toBe('rfid');
  });
});

describe('capability detection', () => {
  it('each adapter reports the capability set matching its registry descriptor', () => {
    for (const descriptor of listAdapterDescriptors()) {
      const adapter = new descriptor.ctor(new MockTransport());
      expect(adapter.capabilities()).toEqual(descriptor.capabilities);
      expect(adapter.deviceType).toBe(descriptor.deviceType);
    }
  });
});

describe('adapter registry + factory', () => {
  it('lists all 7 required device types', () => {
    const types = listAdapterDescriptors()
      .map((d) => d.deviceType)
      .sort();
    expect(types).toEqual(
      [
        'bluetooth',
        'camera',
        'honeywell',
        'rfid',
        'sunmi',
        'usb_hid',
        'zebra',
      ].sort(),
    );
  });

  it('throws for an unknown device type', () => {
    expect(() => getAdapterDescriptor('unknown' as any)).toThrow();
  });

  it('createAdapter returns an instance of the correct class', () => {
    const adapter = createAdapter('zebra', new MockTransport());
    expect(adapter).toBeInstanceOf(ZebraAdapter);
  });
});

describe('AdapterError', () => {
  it('carries a code and recoverable flag', () => {
    const error = new AdapterError('CONNECTION_FAILED', 'boom', true);
    expect(error.code).toBe('CONNECTION_FAILED');
    expect(error.recoverable).toBe(true);
    expect(error.name).toBe('AdapterError');
  });
});
