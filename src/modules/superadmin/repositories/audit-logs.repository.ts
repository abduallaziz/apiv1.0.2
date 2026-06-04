import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';
import { AuditQueryDto } from '../dto/audit-query.dto';

export interface AuditLogEntry {
  id: string;
  tenant_id: string | null;
  actor_id: string;
  actor_role: string;
  action: string;
  resource_type: string;
  resource_id: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  ip_address: string | null;
  device: string | null;
  created_at: string;
}

export interface PaginatedAuditLogs {
  data: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class AuditLogsRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findMany(query: AuditQueryDto): Promise<PaginatedAuditLogs> {
    const { page = 1, limit = 50, actor_id, action, resource_type, tenant_id, from, to } = query;
    const offset = (page - 1) * limit;

    let builder = this.supabase
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (actor_id) builder = builder.eq('actor_id', actor_id);
    if (action) builder = builder.eq('action', action);
    if (resource_type) builder = builder.eq('resource_type', resource_type);
    if (tenant_id) builder = builder.eq('tenant_id', tenant_id);
    if (from) builder = builder.gte('created_at', from);
    if (to) builder = builder.lte('created_at', to);

    const { data, error, count } = await builder;

    if (error) throw new Error(`AuditLogsRepository.findMany: ${error.message}`);

    const total = count ?? 0;

    return {
      data: (data as AuditLogEntry[]) ?? [],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findById(id: string): Promise<AuditLogEntry | null> {
    const { data, error } = await this.supabase
      .from('audit_logs')
      .select('*')
      .eq('id', id)
      .single();

    if (error) return null;
    return data as AuditLogEntry;
  }

  async findForExport(query: Omit<AuditQueryDto, 'page' | 'limit'>): Promise<AuditLogEntry[]> {
    let builder = this.supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false });

    if (query.actor_id) builder = builder.eq('actor_id', query.actor_id);
    if (query.action) builder = builder.eq('action', query.action);
    if (query.resource_type) builder = builder.eq('resource_type', query.resource_type);
    if (query.tenant_id) builder = builder.eq('tenant_id', query.tenant_id);
    if (query.from) builder = builder.gte('created_at', query.from);
    if (query.to) builder = builder.lte('created_at', query.to);

    // max 10,000 rows للـ export
    builder = builder.limit(10000);

    const { data, error } = await builder;
    if (error) throw new Error(`AuditLogsRepository.findForExport: ${error.message}`);
    return (data as AuditLogEntry[]) ?? [];
  }
}