import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { NotificationsRepository } from '../../core/notification/repositories/notifications.repository';
import { NotificationQueryDto } from '../../core/notification/dto/notification-query.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard, TenantGuard)
export class NotificationsController {
  constructor(
    private readonly notificationsRepository: NotificationsRepository,
  ) {}

  @Get()
  async getMyNotifications(
    @Req() req: Request,
    @GetTenant() tenant: TenantContext,
    @Query() query: NotificationQueryDto,
  ) {
    const user = (req as any).user;

    const { records, total } = await this.notificationsRepository.findByUser(
      user.sub,
      tenant.tenantId,
      query.limit,
      query.offset,
    );

    const unreadCount = await this.notificationsRepository.countUnread(
      user.sub,
      tenant.tenantId,
    );

    return {
      data: records,
      meta: { total, unreadCount, limit: query.limit, offset: query.offset },
    };
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAsRead(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    await this.notificationsRepository.markAsRead(id, user.sub);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAllAsRead(
    @Req() req: Request,
    @GetTenant() tenant: TenantContext,
  ) {
    const user = (req as any).user;
    await this.notificationsRepository.markAllAsRead(user.sub, tenant.tenantId);
  }
}