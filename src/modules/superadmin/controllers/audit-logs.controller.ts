import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../../core/permissions/permission.guard';
import { RequirePermission } from '../../../core/permissions/require-permission.decorator';
import { AuditLogsService } from '../services/audit-logs.service';
import { AuditQueryDto } from '../dto/audit-query.dto';

@Controller('superadmin/audit-logs')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@RequirePermission('audit.view.all')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  async findMany(@Query() query: AuditQueryDto) {
    return this.auditLogsService.findMany(query);
  }

  @Get('export')
  async export(
    @Query() query: AuditQueryDto,
    @Query('format') format: 'excel' | 'csv' = 'excel',
    @Res() res: Response,
  ) {
    if (format === 'csv') {
      const csv = await this.auditLogsService.exportToCsv(query);
      const filename = `audit-logs-${Date.now()}.csv`;
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csv);
    }

    const buffer = await this.auditLogsService.exportToExcel(query);
    const filename = `audit-logs-${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  }

  @Get(':id')
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.auditLogsService.findById(id);
  }
}