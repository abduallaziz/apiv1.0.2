import { Controller, Get, Post, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { SuperAdminGuard } from '../guards/superadmin.guard';
import { Audit } from '../../../core/audit/audit.decorator';
import { SuperAdminSubscriptionsService } from '../services/subscriptions.service';
import { ManualPaymentDto } from '../dto/manual-payment.dto';

@Controller('superadmin/subscriptions')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class SuperAdminSubscriptionsController {
  constructor(private readonly subscriptionsService: SuperAdminSubscriptionsService) {}

  @Get()
  findAll(@Query('status') status?: string, @Query('search') search?: string) {
    return this.subscriptionsService.findAll({ status, search });
  }

  @Post('manual-payment')
  @Audit('subscription.manual_payment')
  manualPayment(@Body() dto: ManualPaymentDto) {
    return this.subscriptionsService.manualPayment(dto);
  }

  @Delete(':id/cancel')
  @Audit('subscription.cancel')
  cancel(@Param('id') id: string) {
    return this.subscriptionsService.cancel(id);
  }
}
