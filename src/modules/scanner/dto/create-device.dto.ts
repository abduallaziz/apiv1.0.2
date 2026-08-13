import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export const DEVICE_TYPES = [
  'usb_hid',
  'bluetooth',
  'camera',
  'zebra',
  'honeywell',
  'sunmi',
  'rfid',
  'generic',
] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export class CreateDeviceDto {
  @IsString()
  @IsNotEmpty()
  device_code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsIn(DEVICE_TYPES)
  device_type!: DeviceType;

  @IsOptional()
  @IsUUID()
  assigned_to?: string;

  @IsOptional()
  @IsUUID()
  assigned_warehouse_id?: string;

  @IsOptional()
  @IsString({ each: true })
  capabilities?: string[];
}
