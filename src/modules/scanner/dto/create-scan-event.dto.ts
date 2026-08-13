import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export const SCAN_EVENT_TYPES = ['barcode', 'rfid', 'manual'] as const;
export type ScanEventType = (typeof SCAN_EVENT_TYPES)[number];

export class CreateScanEventDto {
  @IsUUID()
  device_id!: string;

  @IsOptional()
  @IsUUID()
  session_id?: string;

  @IsString()
  @IsNotEmpty()
  raw_value!: string;

  @IsIn(SCAN_EVENT_TYPES)
  scan_type!: ScanEventType;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsISO8601()
  timestamp?: string;

  // Client-generated idempotency key (e.g. mobile app's local event UUID).
  // Optional: adapters that cannot generate one fall back to the
  // dedup-window check instead (see EventsService.ingest).
  @IsOptional()
  @IsString()
  client_event_id?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
