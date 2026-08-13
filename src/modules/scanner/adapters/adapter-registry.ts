import { UsbHidAdapter } from './usb-hid.adapter';
import { BluetoothAdapter } from './bluetooth.adapter';
import { CameraAdapter } from './camera.adapter';
import { ZebraAdapter } from './zebra.adapter';
import { HoneywellAdapter } from './honeywell.adapter';
import { SunmiAdapter } from './sunmi.adapter';
import { RfidAdapter } from './rfid.adapter';
import {
  AdapterDeviceType,
  ITransport,
  ScannerCapability,
} from './adapter.types';
import { BaseAdapter } from './base-adapter';

export interface AdapterDescriptor {
  deviceType: AdapterDeviceType;
  label: string;
  capabilities: ScannerCapability[];
  ctor: new (transport: ITransport) => BaseAdapter;
}

// Static, code-level registry of every supported adapter type — not a
// database table. There is nothing tenant-specific or runtime-mutable
// about "what adapter classes exist"; per-device state (which physical
// device is registered/active/assigned) is already modeled in
// scanner_devices/scanner_device_capabilities (Phase 2/3), which this
// registry does not duplicate.
export const ADAPTER_REGISTRY: Record<AdapterDeviceType, AdapterDescriptor> = {
  usb_hid: {
    deviceType: 'usb_hid',
    label: 'USB HID Scanner',
    capabilities: ['barcode_1d', 'barcode_2d'],
    ctor: UsbHidAdapter,
  },
  bluetooth: {
    deviceType: 'bluetooth',
    label: 'Bluetooth Scanner',
    capabilities: ['barcode_1d', 'barcode_2d', 'bluetooth'],
    ctor: BluetoothAdapter,
  },
  camera: {
    deviceType: 'camera',
    label: 'Camera Scanner',
    capabilities: ['barcode_1d', 'barcode_2d', 'camera'],
    ctor: CameraAdapter,
  },
  zebra: {
    deviceType: 'zebra',
    label: 'Zebra Scanner',
    capabilities: ['barcode_1d', 'barcode_2d'],
    ctor: ZebraAdapter,
  },
  honeywell: {
    deviceType: 'honeywell',
    label: 'Honeywell Scanner',
    capabilities: ['barcode_1d', 'barcode_2d'],
    ctor: HoneywellAdapter,
  },
  sunmi: {
    deviceType: 'sunmi',
    label: 'Sunmi Built-in Scanner',
    capabilities: ['barcode_1d', 'barcode_2d'],
    ctor: SunmiAdapter,
  },
  rfid: {
    deviceType: 'rfid',
    label: 'RFID Reader',
    capabilities: ['rfid'],
    ctor: RfidAdapter,
  },
};

export function listAdapterDescriptors(): AdapterDescriptor[] {
  return Object.values(ADAPTER_REGISTRY);
}

export function getAdapterDescriptor(
  deviceType: AdapterDeviceType,
): AdapterDescriptor {
  const descriptor = ADAPTER_REGISTRY[deviceType];
  if (!descriptor) {
    throw new Error(`No adapter registered for device type "${deviceType}"`);
  }
  return descriptor;
}
