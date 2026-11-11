import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { WashQueueService, Actor } from './wash-queue.service';
import { CreateWashJobDto } from './dto/create-wash-job.dto';
import { ChangeWashStatusDto } from './dto/change-status.dto';
import { AssignWashWorkerDto } from './dto/assign-worker.dto';
import { WashBoardQueryDto } from './dto/board-query.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';

function actorOf(req: Request): Actor {
  const user = req.user as { sub: string; role: string };
  return {
    id: user.sub,
    role: user.role,
    ip: (req.headers['x-forwarded-for'] as string) ?? req.ip ?? '',
    device: req.headers['user-agent'] ?? '',
  };
}

// No queue.* permission exists: the queue reuses the invoice permissions
// (whoever may view / create invoices may see / operate the wash board).
// Re-wash (ready -> washing) additionally requires owner/manager - checked in
// the service by role.
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('wash-queue')
export class WashQueueController {
  constructor(private readonly service: WashQueueService) {}

  @Get('board')
  @RequirePermission('invoice.view')
  board(@Query() q: WashBoardQueryDto, @GetTenant() tenant: TenantContext) {
    return this.service.board(tenant, q.branch_id, q.date);
  }

  @Get(':id')
  @RequirePermission('invoice.view')
  getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.service.getOne(tenant, id);
  }

  @Post()
  @RequirePermission('invoice.create')
  create(
    @Body() dto: CreateWashJobDto,
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
  ) {
    return this.service.create(tenant, dto, actorOf(req));
  }

  @Patch(':id/status')
  @RequirePermission('invoice.create')
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeWashStatusDto,
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
  ) {
    return this.service.changeStatus(tenant, id, dto, actorOf(req));
  }

  @Patch(':id/worker')
  @RequirePermission('invoice.create')
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignWashWorkerDto,
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
  ) {
    return this.service.assign(tenant, id, dto.worker_id ?? null, actorOf(req));
  }
}
