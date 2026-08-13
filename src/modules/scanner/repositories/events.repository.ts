import { Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';

export interface InsertScanEventPayload {
  session_id: string | null;
  device_id: string;
  client_event_id: string | null;
  raw_value: string;
  normalized_value: string;
  event_type: string;
  source: string | null;
  client_timestamp: string;
  metadata: Record<string, unknown>;
  status: 'validated' | 'rejected';
  resolved_entity_type: string | null;
  resolved_entity_id: string | null;
}

@Injectable()
export class EventsRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenantId: string, deviceId?: string, sessionId?: string) {
    let query = this.supabase
      .from('scanner_events')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (deviceId) query = query.eq('device_id', deviceId);
    if (sessionId) query = query.eq('session_id', sessionId);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('scanner_events')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findByClientEventId(
    tenantId: string,
    deviceId: string,
    clientEventId: string,
  ) {
    const { data, error } = await this.supabase
      .from('scanner_events')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('device_id', deviceId)
      .eq('client_event_id', clientEventId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // "Same device, same value, within a short trailing window" dedup rule
  // for adapters that cannot supply a client_event_id (e.g. a dumb USB HID
  // scanner that just types the barcode).
  async findRecentDuplicate(
    tenantId: string,
    deviceId: string,
    normalizedValue: string,
    windowMs: number,
  ) {
    const since = new Date(Date.now() - windowMs).toISOString();
    const { data, error } = await this.supabase
      .from('scanner_events')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('device_id', deviceId)
      .eq('normalized_value', normalizedValue)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // scanner_events is immutable — insert only, no update()/delete().
  async insert(tenantId: string, payload: InsertScanEventPayload) {
    const { data, error } = await this.supabase
      .from('scanner_events')
      .insert({ tenant_id: tenantId, ...payload })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}
