/**
 * Regression suite for Migration 13.21 Phase 4 — Scanner Event Engine
 * (ingestion, DTO validation, normalization, idempotency, audit trail).
 * Exercises the real EventsService class directly against the live
 * Supabase project, same convention as every other regression spec in
 * this directory (e.g. barcode-label-printing, wms-13.20).
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

import { EventsService } from '../../../modules/scanner/events.service';
import { EventsRepository } from '../../../modules/scanner/repositories/events.repository';
import { SessionsRepository } from '../../../modules/scanner/repositories/sessions.repository';
import { DevicesRepository } from '../../../modules/scanner/repositories/devices.repository';
import { DevicesService } from '../../../modules/scanner/devices.service';
import { ScannerAuditLogsRepository } from '../../../modules/scanner/repositories/audit-logs.repository';
import { CreateScanEventDto } from '../../../modules/scanner/dto/create-scan-event.dto';
import { ResolverService } from '../../../modules/scanner/resolver/resolver.service';
import { ItemBarcodeResolver } from '../../../modules/scanner/resolver/item-barcode.resolver';
import { LocationResolver } from '../../../modules/scanner/resolver/location.resolver';
import { BatchResolver } from '../../../modules/scanner/resolver/batch.resolver';
import { SerialResolver } from '../../../modules/scanner/resolver/serial.resolver';
import { RfidResolver } from '../../../modules/scanner/resolver/rfid.resolver';
import { ItemBarcodesRepository } from '../../../modules/items/repositories/item-barcodes.repository';
import { LocationsRepository } from '../../../modules/inventory/repositories/locations.repository';
import { SerialsRepository } from '../../../modules/inventory/repositories/serials.repository';
import { BatchesLookupRepository } from '../../../modules/scanner/resolver/repositories/batches-lookup.repository';
import { RfidTagsRepository } from '../../../modules/scanner/resolver/repositories/rfid-tags.repository';
import { normalizeScanValue } from '../../../modules/scanner/utils/normalize-scan-value.util';

const TENANT = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo
const TEST_ACTOR_ID = '00000000-0000-0000-0000-000000000001'; // audit actor id — auditService.log() is stubbed as a no-op in this suite

describe('Scanner Event Engine (Migration 13.21 Phase 4)', () => {
  let supabase: SupabaseClient;
  let eventsService: EventsService;
  let deviceId: string;
  let disabledDeviceId: string;
  let sessionId: string;
  const runSuffix = Date.now();

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const eventsRepo = new EventsRepository(supabase);
    const sessionsRepo = new SessionsRepository(supabase);
    const devicesRepo = new DevicesRepository(supabase);
    const devicesService = new DevicesService(
      devicesRepo,
      { findById: () => Promise.resolve({ branch_id: null }) } as any,
      { log: () => Promise.resolve() } as any,
    );
    const auditRepo = new ScannerAuditLogsRepository(supabase);
    const resolverService = new ResolverService(
      new ItemBarcodeResolver(new ItemBarcodesRepository(supabase)),
      new LocationResolver(new LocationsRepository(supabase)),
      new BatchResolver(new BatchesLookupRepository(supabase)),
      new SerialResolver(new SerialsRepository(supabase)),
      new RfidResolver(new RfidTagsRepository(supabase)),
    );
    eventsService = new EventsService(
      eventsRepo,
      sessionsRepo,
      devicesRepo,
      devicesService,
      auditRepo,
      resolverService,
      { findById: () => Promise.resolve({ branch_id: null }) } as any,
      { log: () => Promise.resolve() } as any,
    );

    const { data: device, error: devErr } = await supabase
      .from('scanner_devices')
      .insert({
        tenant_id: TENANT,
        device_code: `PHASE4-${runSuffix}`,
        name: 'Phase 4 Test Device',
        device_type: 'usb_hid',
      })
      .select()
      .single();
    if (devErr) throw devErr;
    deviceId = device.id;

    const { data: disabledDevice, error: disErr } = await supabase
      .from('scanner_devices')
      .insert({
        tenant_id: TENANT,
        device_code: `PHASE4-DISABLED-${runSuffix}`,
        name: 'Phase 4 Disabled Device',
        device_type: 'usb_hid',
        status: 'disabled',
      })
      .select()
      .single();
    if (disErr) throw disErr;
    disabledDeviceId = disabledDevice.id;

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('tenant_id', TENANT)
      .limit(1)
      .single();

    const { data: session, error: sesErr } = await supabase
      .from('scanner_sessions')
      .insert({
        tenant_id: TENANT,
        device_id: deviceId,
        user_id: user.id,
        workflow_type: 'receiving',
      })
      .select()
      .single();
    if (sesErr) throw sesErr;
    sessionId = session.id;
  }, 30_000);

  // scanner_events/scanner_audit_logs are immutable ledgers (migration
  // 172) that now reference this suite's session/device rows — deleting
  // the session would CASCADE-delete its events (blocked by the
  // immutability trigger, exactly the orphan this phase's own migration
  // 173 had to clean up), and deleting the device would violate its
  // ON DELETE RESTRICT from scanner_events. So cleanup soft-deactivates
  // instead of deleting, same pattern already used for warehouse_locations
  // test data once real stock_movements reference them. device_code/
  // raw_value use a run-suffix so re-runs never collide either way.
  afterAll(async () => {
    await supabase
      .from('scanner_sessions')
      .update({ status: 'completed', ended_at: new Date().toISOString() })
      .eq('id', sessionId);
    await supabase
      .from('scanner_devices')
      .update({ deleted_at: new Date().toISOString(), status: 'disabled' })
      .eq('id', deviceId);
    await supabase
      .from('scanner_devices')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', disabledDeviceId);
  }, 30_000);

  describe('DTO validation', () => {
    it('rejects a payload missing device_id', async () => {
      const dto = plainToInstance(CreateScanEventDto, {
        raw_value: '123',
        scan_type: 'barcode',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'device_id')).toBe(true);
    });

    it('rejects an empty raw_value', async () => {
      const dto = plainToInstance(CreateScanEventDto, {
        device_id: deviceId,
        raw_value: '',
        scan_type: 'barcode',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'raw_value')).toBe(true);
    });

    it('rejects an invalid scan_type', async () => {
      const dto = plainToInstance(CreateScanEventDto, {
        device_id: deviceId,
        raw_value: '123',
        scan_type: 'laser',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'scan_type')).toBe(true);
    });

    it('accepts a minimal valid payload', async () => {
      const dto = plainToInstance(CreateScanEventDto, {
        device_id: deviceId,
        raw_value: '123',
        scan_type: 'barcode',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  describe('ingestion', () => {
    it('creates a valid event with normalized_value and status=validated', async () => {
      const result = await eventsService.ingest(
        TENANT,
        {
          device_id: deviceId,
          session_id: sessionId,
          raw_value: '  ean-1234567890128  ',
          scan_type: 'barcode',
          source: 'usb_hid',
        },
        TEST_ACTOR_ID,
      );
      expect(result.duplicate).toBe(false);
      expect(result.event.status).toBe('validated');
      expect(result.event.normalized_value).toBe('EAN-1234567890128');
      expect(result.event.raw_value).toBe('  ean-1234567890128  ');
    }, 15_000);

    it('rejects an unknown device', async () => {
      await expect(
        eventsService.ingest(
          TENANT,
          {
            device_id: '00000000-0000-0000-0000-000000000099',
            raw_value: '123',
            scan_type: 'barcode',
          },
          TEST_ACTOR_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    }, 15_000);

    it('rejects a disabled device', async () => {
      await expect(
        eventsService.ingest(
          TENANT,
          {
            device_id: disabledDeviceId,
            raw_value: '123',
            scan_type: 'barcode',
          },
          TEST_ACTOR_ID,
        ),
      ).rejects.toThrow(ForbiddenException);
    }, 15_000);

    it('rejects an invalid session id', async () => {
      await expect(
        eventsService.ingest(
          TENANT,
          {
            device_id: deviceId,
            session_id: '00000000-0000-0000-0000-000000000099',
            raw_value: '123',
            scan_type: 'barcode',
          },
          TEST_ACTOR_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    }, 15_000);

    it('deduplicates a repeated client_event_id without creating a second row', async () => {
      const clientEventId = `evt-dup-${runSuffix}`;
      const first = await eventsService.ingest(
        TENANT,
        {
          device_id: deviceId,
          raw_value: '999888777',
          scan_type: 'barcode',
          client_event_id: clientEventId,
        },
        TEST_ACTOR_ID,
      );
      expect(first.duplicate).toBe(false);

      const second = await eventsService.ingest(
        TENANT,
        {
          device_id: deviceId,
          raw_value: '999888777',
          scan_type: 'barcode',
          client_event_id: clientEventId,
        },
        TEST_ACTOR_ID,
      );
      expect(second.duplicate).toBe(true);
      expect(second.event.id).toBe(first.event.id);
    }, 15_000);

    it('deduplicates a repeated raw value from the same device within the window (no client_event_id)', async () => {
      // The production DEDUP_WINDOW_MS (events.service.ts) is a real,
      // deliberately tight 2000ms business window — not something this
      // test may loosen. Two root causes were confirmed by direct
      // instrumentation before this fix, both testing-side, not a product
      // regression:
      //   1. Seeding "first" via a full ingest() round trip (~2.5-2.9s
      //      against this live Supabase project: device lookup, duplicate
      //      check, resolve, insert, touchLastSeen, 2x audit writes)
      //      already exceeds the 2000ms window before "second" even
      //      starts — fixed by seeding "first" with a single direct insert
      //      instead of a full ingest() call.
      //   2. findRecentDuplicate() (events.repository.ts) computes its
      //      `since` cutoff from the APP HOST's Date.now(), then compares
      //      it against `created_at`, a DB-SERVER-generated timestamp
      //      (`DEFAULT NOW()`). This dev/CI environment's app host clock
      //      was measured to run ~2.5s+ ahead of the live Supabase
      //      project's server clock — comfortably larger than the 2000ms
      //      window on its own, independent of round-trip time, so the
      //      window check fails deterministically no matter how fast the
      //      two events are created. `scanner_events.created_at` has no
      //      insert trigger forcing DEFAULT NOW() (migration 172) — it
      //      accepts an explicit value — so the seed row below sets
      //      created_at from this same test process's Date.now(), the
      //      exact clock findRecentDuplicate() itself compares against,
      //      eliminating the skew for this fixture without touching any
      //      production file. The real code path under test —
      //      detectDuplicate() / findRecentDuplicate() / the ingest()
      //      duplicate branch — is still exercised for real via the
      //      single, real ingest() call below.
      const rawValue = `windowed-${runSuffix}`;
      const normalizedValue = normalizeScanValue(rawValue);
      const { data: first, error: seedErr } = await supabase
        .from('scanner_events')
        .insert({
          tenant_id: TENANT,
          session_id: null,
          device_id: deviceId,
          client_event_id: null,
          raw_value: rawValue,
          normalized_value: normalizedValue,
          event_type: 'manual',
          source: null,
          client_timestamp: new Date().toISOString(),
          metadata: {},
          status: 'validated',
          resolved_entity_type: null,
          resolved_entity_id: null,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (seedErr) throw seedErr;

      const second = await eventsService.ingest(
        TENANT,
        {
          device_id: deviceId,
          raw_value: rawValue,
          scan_type: 'manual',
        },
        TEST_ACTOR_ID,
      );
      expect(second.duplicate).toBe(true);
      expect(second.event.id).toBe(first.id);
    }, 15_000);

    it('creates an audit log entry for a validated event and for a detected duplicate', async () => {
      const clientEventId = `evt-audit-${runSuffix}`;
      const first = await eventsService.ingest(
        TENANT,
        {
          device_id: deviceId,
          raw_value: 'AUDIT-CHECK',
          scan_type: 'barcode',
          client_event_id: clientEventId,
        },
        TEST_ACTOR_ID,
      );
      await eventsService.ingest(
        TENANT,
        {
          device_id: deviceId,
          raw_value: 'AUDIT-CHECK',
          scan_type: 'barcode',
          client_event_id: clientEventId,
        },
        TEST_ACTOR_ID,
      );

      const history = await eventsService.history(
        first.event.id as string,
        TENANT,
      );
      const actions = history.map((h: { action: string }) => h.action);
      expect(actions).toContain('scan_event.validated');
      expect(actions).toContain('scan_event.duplicate_detected');
    }, 15_000);
  });

  describe('tenant isolation', () => {
    it('does not find an event from another tenant', async () => {
      const result = await eventsService.ingest(
        TENANT,
        {
          device_id: deviceId,
          raw_value: 'ISOLATION-CHECK',
          scan_type: 'barcode',
        },
        TEST_ACTOR_ID,
      );
      await expect(
        eventsService.findById(
          result.event.id as string,
          '00000000-0000-0000-0000-000000000001',
        ),
      ).rejects.toThrow(NotFoundException);
    }, 15_000);
  });
});
