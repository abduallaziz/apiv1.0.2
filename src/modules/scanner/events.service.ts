import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventsRepository } from './repositories/events.repository';
import { SessionsRepository } from './repositories/sessions.repository';
import { ScannerAuditLogsRepository } from './repositories/audit-logs.repository';
import { DevicesRepository } from './repositories/devices.repository';
import { DevicesService } from './devices.service';
import { CreateScanEventDto } from './dto/create-scan-event.dto';
import { normalizeScanValue } from './utils/normalize-scan-value.util';
import { ResolverService } from './resolver/resolver.service';
import { ResolutionResult } from './resolver/resolver.types';
import { isUniqueViolation } from '../../shared/supabase/postgrest-error.util';

// Same-device/same-value scans within this trailing window are treated as
// one duplicate scan when no client_event_id is supplied (e.g. a dumb
// scanner that just re-emits the barcode on a second trigger pull).
const DEDUP_WINDOW_MS = 2000;

export interface ScanEventResult {
  duplicate: boolean;
  event: Record<string, unknown>;
  resolution?: ResolutionResult;
}

@Injectable()
export class EventsService {
  constructor(
    private readonly eventsRepo: EventsRepository,
    private readonly sessionsRepo: SessionsRepository,
    private readonly devicesRepo: DevicesRepository,
    private readonly devicesService: DevicesService,
    private readonly auditRepo: ScannerAuditLogsRepository,
    private readonly resolverService: ResolverService,
  ) {}

  findAll(tenantId: string, deviceId?: string, sessionId?: string) {
    return this.eventsRepo.findAll(tenantId, deviceId, sessionId);
  }

  async findById(id: string, tenantId: string) {
    const event = await this.eventsRepo.findById(id, tenantId);
    if (!event) throw new NotFoundException('Scan event not found');
    return event;
  }

  async history(id: string, tenantId: string) {
    await this.findById(id, tenantId); // 404s if not found/wrong tenant
    return this.auditRepo.findByEntity(tenantId, 'scanner_event', id);
  }

  async ingest(
    tenantId: string,
    dto: CreateScanEventDto,
  ): Promise<ScanEventResult> {
    // 1. Device ownership/authorization
    const device = await this.devicesRepo.findById(dto.device_id, tenantId);
    if (!device) throw new NotFoundException('Unknown device');
    if (device.status !== 'active') {
      throw new ForbiddenException('Device is not authorized to submit scans');
    }

    // 2. Session validation (only if supplied — sessionless scans are valid)
    if (dto.session_id) {
      const session = await this.sessionsRepo.findById(
        dto.session_id,
        tenantId,
      );
      if (!session) throw new BadRequestException('Invalid session');
      if (session.device_id !== dto.device_id) {
        throw new BadRequestException('Session does not belong to this device');
      }
      if (session.status !== 'active') {
        throw new BadRequestException('Session is not active');
      }
    }

    // 3. Normalization (the Resolver Engine, step 5 below, consumes
    // normalized_value)
    const normalizedValue = normalizeScanValue(dto.raw_value);
    const clientTimestamp = dto.timestamp
      ? new Date(dto.timestamp)
      : new Date();

    // 4. Idempotency
    const duplicate = await this.detectDuplicate(
      tenantId,
      dto,
      normalizedValue,
    );
    if (duplicate) {
      await this.auditRepo.create(tenantId, {
        actor_type: 'device',
        actor_id: dto.device_id,
        action: 'scan_event.duplicate_detected',
        entity_type: 'scanner_event',
        entity_id: duplicate.id,
        details: {
          raw_value: dto.raw_value,
          client_event_id: dto.client_event_id ?? null,
        },
      });
      return { duplicate: true, event: duplicate };
    }

    // 5. Resolution (Phase 5 — identification only, read-only, never
    // touches inventory/stock/cost or executes a workflow). Run BEFORE
    // insert so the result can be written in the same atomic insert —
    // scanner_events is immutable, so there is no later UPDATE step to set
    // resolved_entity_type/resolved_entity_id after the fact.
    const resolution = await this.resolverService.resolve(normalizedValue, {
      tenantId,
      warehouseId: device.assigned_warehouse_id ?? undefined,
    });

    // 6. Persist (this insert IS the RECEIVED->VALIDATED transition —
    // nothing failing validation reaches this point, per the immutable-
    // ledger design documented in migration 173)
    let event: Record<string, unknown>;
    try {
      event = await this.eventsRepo.insert(tenantId, {
        session_id: dto.session_id ?? null,
        device_id: dto.device_id,
        client_event_id: dto.client_event_id ?? null,
        raw_value: dto.raw_value,
        normalized_value: normalizedValue,
        event_type: dto.scan_type,
        source: dto.source ?? null,
        client_timestamp: clientTimestamp.toISOString(),
        metadata: dto.metadata ?? {},
        status: 'validated',
        resolved_entity_type:
          resolution.status === 'matched' ? resolution.entity_type : null,
        resolved_entity_id:
          resolution.status === 'matched' ? resolution.entity_id : null,
      });
    } catch (error) {
      // Race: a concurrent request with the same client_event_id won the
      // insert between our dedup check and our own insert.
      if (isUniqueViolation(error) && dto.client_event_id) {
        const existing = await this.eventsRepo.findByClientEventId(
          tenantId,
          dto.device_id,
          dto.client_event_id,
        );
        if (existing) {
          await this.auditRepo.create(tenantId, {
            actor_type: 'device',
            actor_id: dto.device_id,
            action: 'scan_event.duplicate_detected',
            entity_type: 'scanner_event',
            entity_id: existing.id,
            details: { raw_value: dto.raw_value, reason: 'race_condition' },
          });
          return { duplicate: true, event: existing };
        }
      }
      throw error;
    }

    await this.devicesService.touchLastSeen(dto.device_id, tenantId, 'healthy');

    await this.auditRepo.create(tenantId, {
      actor_type: 'device',
      actor_id: dto.device_id,
      action: 'scan_event.validated',
      entity_type: 'scanner_event',
      entity_id: event.id as string,
      details: { event_type: dto.scan_type, source: dto.source ?? null },
    });

    return { duplicate: false, event, resolution };
  }

  private async detectDuplicate(
    tenantId: string,
    dto: CreateScanEventDto,
    normalizedValue: string,
  ) {
    if (dto.client_event_id) {
      return this.eventsRepo.findByClientEventId(
        tenantId,
        dto.device_id,
        dto.client_event_id,
      );
    }
    return this.eventsRepo.findRecentDuplicate(
      tenantId,
      dto.device_id,
      normalizedValue,
      DEDUP_WINDOW_MS,
    );
  }
}
