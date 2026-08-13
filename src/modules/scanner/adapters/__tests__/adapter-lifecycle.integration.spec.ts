import { UsbHidAdapter } from '../usb-hid.adapter';
import { RfidAdapter } from '../rfid.adapter';
import { MockTransport } from './mock-transport';
import { AdapterError, NormalizedDeviceEvent } from '../adapter.types';

// Integration-style: exercises the full contract (connect -> hardware
// pushes data -> adapter parses/normalizes -> ScanEvent emitted) end to
// end through MockTransport, since no physical hardware is available in
// this backend process (see adapter.types.ts's architecture note).

describe('Adapter lifecycle: connect, receive, produce ScanEvent', () => {
  it('starts initialized, becomes connected after connect()', async () => {
    const transport = new MockTransport();
    const adapter = new UsbHidAdapter(transport);
    expect(adapter.state).toBe('initialized');

    await adapter.connect();
    expect(adapter.state).toBe('connected');
    expect(transport.isOpen()).toBe(true);
  });

  it('produces a normalized ScanEvent shaped like CreateScanEventDto when hardware pushes a raw chunk', async () => {
    const transport = new MockTransport();
    const adapter = new UsbHidAdapter(transport);
    await adapter.connect();

    const received: NormalizedDeviceEvent[] = [];
    adapter.onScan((event) => received.push(event));

    transport.emit('9781234567897\r\n');

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      raw_value: '9781234567897',
      scan_type: 'barcode',
      source: 'usb_hid',
    });
    expect(typeof received[0].timestamp).toBe('string');
    expect(adapter.state).toBe('connected'); // returns to connected after the transient streaming tick
  });

  it('handles a burst of chunks without getting stuck in an invalid state', async () => {
    const transport = new MockTransport();
    const adapter = new UsbHidAdapter(transport);
    await adapter.connect();

    const received: NormalizedDeviceEvent[] = [];
    adapter.onScan((event) => received.push(event));

    transport.emit('AAA\r\n');
    transport.emit('BBB\r\n');
    transport.emit('CCC\r\n');

    expect(received.map((e) => e.raw_value)).toEqual(['AAA', 'BBB', 'CCC']);
    expect(adapter.state).toBe('connected');
  });

  it('drops a single malformed chunk without disconnecting (RFID: no hex payload)', async () => {
    const transport = new MockTransport();
    const adapter = new RfidAdapter(transport);
    await adapter.connect();

    const received: NormalizedDeviceEvent[] = [];
    adapter.onScan((event) => received.push(event));

    transport.emit('not hex');
    expect(received).toHaveLength(0);
    expect(adapter.state).toBe('connected'); // still connected, not torn down

    transport.emit('e2003412012345670000abcd');
    expect(received).toHaveLength(1);
  });

  it('ignores chunks that arrive before connect()', () => {
    const transport = new MockTransport();
    const adapter = new UsbHidAdapter(transport);
    const received: NormalizedDeviceEvent[] = [];
    adapter.onScan((event) => received.push(event));

    transport.emit('1234\r\n');
    expect(received).toHaveLength(0);
  });

  it('disconnect() closes the transport and moves to disconnected', async () => {
    const transport = new MockTransport();
    const adapter = new UsbHidAdapter(transport);
    await adapter.connect();
    await adapter.disconnect();
    expect(adapter.state).toBe('disconnected');
    expect(transport.isOpen()).toBe(false);
  });

  it('healthCheck reports unhealthy when not connected, healthy when connected', async () => {
    const transport = new MockTransport();
    const adapter = new UsbHidAdapter(transport);
    expect((await adapter.healthCheck()).healthy).toBe(false);

    await adapter.connect();
    expect((await adapter.healthCheck()).healthy).toBe(true);
  });

  it('connect() failure moves to error state and throws a recoverable AdapterError', async () => {
    const transport = new MockTransport();
    transport.failOnOpen = true;
    const adapter = new UsbHidAdapter(transport);

    await expect(adapter.connect()).rejects.toThrow(AdapterError);
    expect(adapter.state).toBe('error');
  });

  it('recover() reconnects after a failed connect once the transport is fixed', async () => {
    const transport = new MockTransport();
    transport.failOnOpen = true;
    const adapter = new UsbHidAdapter(transport);
    await expect(adapter.connect()).rejects.toThrow(AdapterError);

    transport.failOnOpen = false;
    await adapter.recover();
    expect(adapter.state).toBe('connected');
  });

  it('recover() is only valid from the error state', async () => {
    const transport = new MockTransport();
    const adapter = new UsbHidAdapter(transport);
    await adapter.connect();
    await expect(adapter.recover()).rejects.toThrow(AdapterError);
  });
});
