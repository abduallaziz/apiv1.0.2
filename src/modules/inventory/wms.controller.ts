import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { WmsService } from './wms.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { CreatePickListDto } from './dto/create-pick-list.dto';
import { CreateZoneSplitPickListsDto } from './dto/create-zone-split-pick-lists.dto';
import { CreateWaveDto } from './dto/create-wave.dto';
import { ReleaseWaveDto } from './dto/release-wave.dto';
import { CancelWaveDto } from './dto/cancel-wave.dto';
import { AssignPickListDto } from './dto/assign-pick-list.dto';
import { CancelPickListDto } from './dto/cancel-pick-list.dto';
import { ConfirmPickDto } from './dto/confirm-pick.dto';
import { ConfirmPackDto } from './dto/confirm-pack.dto';
import { ShipShipmentDto } from './dto/ship-shipment.dto';
import { CancelShipmentDto } from './dto/cancel-shipment.dto';
import { RecordShortPickDto } from './dto/record-short-pick.dto';
import { RecordDamageDto } from './dto/record-damage.dto';
import { RecordLostItemDto } from './dto/record-lost-item.dto';
import { RecoverLostItemDto } from './dto/recover-lost-item.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';
import {
  ShipmentsQueryDto,
  PickListsQueryDto,
  WavesQueryDto,
  ExceptionsQueryDto,
} from './dto/wms-list-query.dto';

// Inventory #7 / F2 throttler audit (Owner-approved, narrowest correct fix
// per the audit) — the 'auth' throttler tier (10 req/60s) exists solely for
// credential-guessing protection on login/register/etc (see
// auth.controller.ts, STATUS.md §3240-3245: it was previously found to
// leak onto refresh/logout too and was fixed there with this exact
// @SkipThrottle({auth:true}) pattern). It was never meant to bound business
// APIs — but NestJS's ThrottlerModule applies every registered named tier
// to every route by default via the global APP_GUARD unless a controller
// opts out. WmsController had no such opt-out, so every WMS write/read was
// silently capped at the credential-guessing limit, not the real per-tenant
// business-API limit ('global'/'global-ip', 600/min — still fully in
// effect below). AuthController is the ONLY other controller with any
// @SkipThrottle in the codebase; every other business controller has this
// same latent gap and was out of scope for this audit — flagged, not
// touched, since only WMS was evidenced as broken here.
@SkipThrottle({ auth: true })
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/wms')
export class WmsController {
  constructor(private readonly wmsService: WmsService) {}

  @Get('shipments')
  @RequirePermission('inventory.view')
  findShipments(
    @Query() query: ShipmentsQueryDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.wmsService.findShipments(tenant.tenantId, query);
  }

  @Get('shipments/:id')
  @RequirePermission('inventory.view')
  findShipment(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.wmsService.findShipmentById(id, tenant.tenantId);
  }

  @Post('shipments')
  @RequirePermission('inventory.fulfill')
  createShipment(
    @Body() dto: CreateShipmentDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.wmsService.createShipment(tenant.tenantId, dto);
  }

  @Post('shipments/:id/cancel')
  @RequirePermission('inventory.fulfill')
  @HttpCode(HttpStatus.OK)
  cancelShipment(
    @Param('id') id: string,
    @Body() dto: CancelShipmentDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.wmsService.cancelShipment(
      id,
      tenant.tenantId,
      dto.reason,
      user.sub,
    );
  }

  @Post('shipments/:id/ship')
  @RequirePermission('inventory.fulfill')
  @HttpCode(HttpStatus.OK)
  shipShipment(
    @Param('id') id: string,
    @Body() dto: ShipShipmentDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.wmsService.shipShipment(
      id,
      tenant.tenantId,
      user.sub,
      dto.tracking_number,
    );
  }

  @Post('shipment-lines/:id/pack')
  @RequirePermission('inventory.fulfill')
  @HttpCode(HttpStatus.OK)
  confirmPack(
    @Param('id') id: string,
    @Body() dto: ConfirmPackDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.wmsService.confirmPack(
      id,
      tenant.tenantId,
      dto.quantity,
      user.sub,
    );
  }

  // Inventory #7 / 7-7 (Owner-approved) — Exception Handling Primitives.
  @Post('shipment-lines/:id/short-pick')
  @RequirePermission('inventory.fulfill')
  @HttpCode(HttpStatus.OK)
  recordShortPick(
    @Param('id') id: string,
    @Body() dto: RecordShortPickDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.wmsService.recordShortPick(
      id,
      tenant.tenantId,
      dto.reason,
      user.sub,
    );
  }

  @Post('shipment-lines/:id/damage')
  @RequirePermission('inventory.fulfill')
  @HttpCode(HttpStatus.OK)
  recordDamage(
    @Param('id') id: string,
    @Body() dto: RecordDamageDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.wmsService.recordDamage(
      id,
      tenant.tenantId,
      dto.quantity,
      dto.reason,
      user.sub,
    );
  }

  @Post('shipment-lines/:id/lost')
  @RequirePermission('inventory.fulfill')
  @HttpCode(HttpStatus.OK)
  recordLostItem(
    @Param('id') id: string,
    @Body() dto: RecordLostItemDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.wmsService.recordLostItem(
      id,
      tenant.tenantId,
      dto.quantity,
      dto.reason,
      user.sub,
    );
  }

  @Post('exceptions/:id/recover')
  @RequirePermission('inventory.fulfill')
  @HttpCode(HttpStatus.OK)
  recoverLostItem(
    @Param('id') id: string,
    @Body() dto: RecoverLostItemDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.wmsService.recoverLostItem(
      id,
      tenant.tenantId,
      dto.quantity,
      dto.reason,
      user.sub,
      dto.unit_cost,
    );
  }

  @Get('exceptions')
  @RequirePermission('inventory.view')
  findExceptions(
    @Query() query: ExceptionsQueryDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.wmsService.findExceptions(tenant.tenantId, query);
  }

  @Get('pick-lists')
  @RequirePermission('inventory.view')
  findPickLists(
    @Query() query: PickListsQueryDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.wmsService.findPickLists(tenant.tenantId, query);
  }

  @Get('pick-lists/:id')
  @RequirePermission('inventory.view')
  findPickList(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.wmsService.findPickListById(id, tenant.tenantId);
  }

  @Post('pick-lists')
  @RequirePermission('inventory.fulfill')
  createPickList(
    @Body() dto: CreatePickListDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.wmsService.createPickList(tenant.tenantId, dto, user.sub);
  }

  // Inventory #7 / 7-4/7-5 (Owner-approved) — Wave create + evaluate.

  @Get('waves')
  @RequirePermission('inventory.view')
  findWaves(@Query() query: WavesQueryDto, @GetTenant() tenant: TenantContext) {
    return this.wmsService.findWaves(tenant.tenantId, query);
  }

  @Get('waves/:id')
  @RequirePermission('inventory.view')
  findWave(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.wmsService.findWaveById(id, tenant.tenantId);
  }

  // Inventory #7 / F7 gap closure (Owner-approved) — same real
  // warehouse_work_status_history source as pick-lists/:id/history, just
  // entity_type='wave'. No new table.
  @Get('waves/:id/history')
  @RequirePermission('inventory.view')
  waveHistory(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.wmsService.waveHistory(id, tenant.tenantId);
  }

  @Post('waves')
  @RequirePermission('inventory.fulfill')
  createWave(
    @Body() dto: CreateWaveDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.wmsService.createWave(tenant.tenantId, dto, user.sub);
  }

  @Post('waves/:id/evaluate')
  @RequirePermission('inventory.fulfill')
  @HttpCode(HttpStatus.OK)
  evaluateWave(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.wmsService.evaluateWaveEligibility(
      id,
      tenant.tenantId,
      user.sub,
    );
  }

  // Inventory #7 / 7-6 (Owner-approved) — Wave Claim + Release. Claim is
  // an atomic sub-step inside release (see fn_release_wave, migration
  // 237) — there is no separate claim endpoint by design.
  @Post('waves/:id/release')
  @RequirePermission('inventory.fulfill')
  @HttpCode(HttpStatus.OK)
  releaseWave(
    @Param('id') id: string,
    @Body() dto: ReleaseWaveDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.wmsService.releaseWave(
      id,
      tenant.tenantId,
      user.sub,
      dto.priority,
    );
  }

  @Post('waves/:id/cancel')
  @RequirePermission('inventory.fulfill')
  @HttpCode(HttpStatus.OK)
  cancelWave(
    @Param('id') id: string,
    @Body() dto: CancelWaveDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.wmsService.cancelWave(
      id,
      tenant.tenantId,
      dto.reason,
      user.sub,
    );
  }

  // Inventory #7 / 7-3 (Owner-approved) — automatic multi-zone splitting.
  // Registered before ':id' routes below it are not affected (different
  // path segment), but kept adjacent to createPickList for discoverability.
  @Post('pick-lists/zone-split')
  @RequirePermission('inventory.fulfill')
  createZoneSplitPickLists(
    @Body() dto: CreateZoneSplitPickListsDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.wmsService.createZoneSplitPickLists(
      tenant.tenantId,
      dto,
      user.sub,
    );
  }

  @Get('pick-lists/:id/history')
  @RequirePermission('inventory.view')
  pickListHistory(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.wmsService.pickListHistory(id, tenant.tenantId);
  }

  @Post('pick-lists/:id/assign')
  @RequirePermission('inventory.fulfill')
  @HttpCode(HttpStatus.OK)
  assignPickList(
    @Param('id') id: string,
    @Body() dto: AssignPickListDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.wmsService.assignPickList(
      id,
      tenant.tenantId,
      dto.assigned_to,
      user.sub,
    );
  }

  @Post('pick-lists/:id/cancel')
  @RequirePermission('inventory.fulfill')
  @HttpCode(HttpStatus.OK)
  cancelPickList(
    @Param('id') id: string,
    @Body() dto: CancelPickListDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.wmsService.cancelPickList(
      id,
      tenant.tenantId,
      dto.reason,
      user.sub,
    );
  }

  @Post('pick-list-lines/:id/pick')
  @RequirePermission('inventory.fulfill')
  @HttpCode(HttpStatus.OK)
  confirmPick(
    @Param('id') id: string,
    @Body() dto: ConfirmPickDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.wmsService.confirmPick(
      id,
      tenant.tenantId,
      dto.quantity,
      user.sub,
      dto.batch_id,
    );
  }
}
