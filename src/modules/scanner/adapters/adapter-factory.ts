import { AdapterDeviceType, ITransport } from './adapter.types';
import { BaseAdapter } from './base-adapter';
import { getAdapterDescriptor } from './adapter-registry';

// The caller (client runtime — browser SDK or Mobile Scanner App, Phase
// 8) always supplies the transport, since it is the one holding the
// actual hardware connection. This factory only picks the right parsing/
// normalization class for the requested device type.
export function createAdapter(
  deviceType: AdapterDeviceType,
  transport: ITransport,
): BaseAdapter {
  const descriptor = getAdapterDescriptor(deviceType);
  return new descriptor.ctor(transport);
}
