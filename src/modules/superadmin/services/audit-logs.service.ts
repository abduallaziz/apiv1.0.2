import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogsRepository, PaginatedAuditLogs, AuditLogEntry } from '../repositories/audit-logs.repository';
import { AuditQueryDto } from '../dto/audit-query.dto';
import * as ExcelJS from 'exceljs';

@Injectable()
export class AuditLogsService {
  constructor(private readonly auditLogsRepository: AuditLogsRepository) {}

  async findMany(query: AuditQueryDto): Promise<PaginatedAuditLogs> {
    return this.auditLogsRepository.findMany(query);
  }

  async findById(id: string): Promise<AuditLogEntry> {
    const log = await this.auditLogsRepository.findById(id);
    if (!log) throw new NotFoundException(`Audit log ${id} not found`);
    return log;
  }

  async exportToExcel(query: Omit<AuditQueryDto, 'page' | 'limit'>): Promise<Buffer> {
    const logs = await this.auditLogsRepository.findForExport(query);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Audit Logs');

    sheet.columns = [
      { header: 'ID', key: 'id', width: 38 },
      { header: 'Tenant ID', key: 'tenant_id', width: 38 },
      { header: 'Actor ID', key: 'actor_id', width: 38 },
      { header: 'Actor Role', key: 'actor_role', width: 14 },
      { header: 'Action', key: 'action', width: 30 },
      { header: 'Resource Type', key: 'resource_type', width: 18 },
      { header: 'Resource ID', key: 'resource_id', width: 38 },
      { header: 'IP Address', key: 'ip_address', width: 18 },
      { header: 'Device', key: 'device', width: 40 },
      { header: 'Created At', key: 'created_at', width: 24 },
    ];

    // Header row styling
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E2130' },
    };
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    for (const log of logs) {
      sheet.addRow({
        id: log.id,
        tenant_id: log.tenant_id ?? 'superadmin',
        actor_id: log.actor_id,
        actor_role: log.actor_role,
        action: log.action,
        resource_type: log.resource_type,
        resource_id: log.resource_id,
        ip_address: log.ip_address ?? '-',
        device: log.device ?? '-',
        created_at: log.created_at,
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async exportToCsv(query: Omit<AuditQueryDto, 'page' | 'limit'>): Promise<string> {
    const logs = await this.auditLogsRepository.findForExport(query);

    const headers = [
      'id', 'tenant_id', 'actor_id', 'actor_role',
      'action', 'resource_type', 'resource_id',
      'ip_address', 'device', 'created_at',
    ];

    const rows = logs.map((log) =>
      [
        log.id,
        log.tenant_id ?? 'superadmin',
        log.actor_id,
        log.actor_role,
        log.action,
        log.resource_type,
        log.resource_id,
        log.ip_address ?? '',
        `"${(log.device ?? '').replace(/"/g, "'")}"`,
        log.created_at,
      ].join(','),
    );

    return [headers.join(','), ...rows].join('\n');
  }
}