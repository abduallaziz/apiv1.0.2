import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';
import { PrintService } from './print.service';
import { TemplateQueryDto, UpdateTemplateDto } from './dto/update-template.dto';
import { TemplateKind } from './print.types';

enum KindEnum {
  invoice = 'invoice',
  kitchen = 'kitchen',
}

@Controller('print')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class PrintController {
  constructor(private readonly service: PrintService) {}

  // One payload for the web POS and the Android app. `tendered` is the cash
  // the customer handed over (not persisted on orders); it only drives the
  // printed "cash / change" lines.
  @Get('invoice/:orderId')
  @RequirePermission('invoice.view')
  invoice(
    @GetTenant() tenant: TenantContext,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Query('tendered') tendered?: string,
  ) {
    let t: number | undefined;
    if (tendered !== undefined && tendered !== '') {
      t = Number(tendered);
      if (!Number.isFinite(t) || t < 0) {
        throw new BadRequestException('tendered must be a non-negative number');
      }
    }
    return this.service.getInvoicePayload(tenant.tenantId, orderId, {
      tendered: t,
    });
  }

  @Get('kitchen/:orderId')
  @RequirePermission('invoice.view')
  kitchen(
    @GetTenant() tenant: TenantContext,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Query('all') all?: string,
  ) {
    return this.service.getKitchenPayload(tenant.tenantId, orderId, {
      all: all === 'true' || all === '1',
    });
  }

  @Get('templates/:kind')
  @RequirePermission('settings.view')
  getTemplate(
    @GetTenant() tenant: TenantContext,
    @Param('kind', new ParseEnumPipe(KindEnum)) kind: TemplateKind,
    @Query() query: TemplateQueryDto,
  ) {
    return this.service.getTemplate(tenant.tenantId, kind, query.branch_id);
  }

  @Patch('templates/:kind')
  @RequirePermission('settings.manage')
  updateTemplate(
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('kind', new ParseEnumPipe(KindEnum)) kind: TemplateKind,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.service.updateTemplate(
      tenant.tenantId,
      user.sub,
      kind,
      dto.template,
      dto.branch_id,
    );
  }

  @Delete('templates/:kind/branch/:branchId')
  @RequirePermission('settings.manage')
  clearOverride(
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Param('kind', new ParseEnumPipe(KindEnum)) kind: TemplateKind,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.service.clearBranchOverride(
      tenant.tenantId,
      user.sub,
      kind,
      branchId,
    );
  }

  @Post('logo')
  @RequirePermission('settings.manage')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 1024 * 1024, files: 1 } }),
  )
  uploadLogo(
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.uploadLogo(tenant.tenantId, user.sub, file);
  }
}
