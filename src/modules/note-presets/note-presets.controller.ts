import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { NotePresetsService } from './note-presets.service';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { CreateNotePresetDto } from './dto/create-note-preset.dto';
import { UpdateNotePresetDto } from './dto/update-note-preset.dto';
import { ReorderNotePresetsDto } from './dto/reorder-note-presets.dto';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('note-presets')
export class NotePresetsController {
  constructor(private readonly service: NotePresetsService) {}

  @Get()
  @RequirePermission('note_presets.manage')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.service.findAll(tenant);
  }

  // Read-only, active-only list — gated by the same checkout permission POS itself
  // requires (mirrors coupons' /validate), since any cashier picking a preset note
  // at checkout needs this list, not just whoever manages the preset definitions.
  @Get('active')
  @RequirePermission('invoice.create.own')
  findActive(@GetTenant() tenant: TenantContext) {
    return this.service.findActive(tenant);
  }

  @Post()
  @RequirePermission('note_presets.manage')
  create(@GetTenant() tenant: TenantContext, @Body() dto: CreateNotePresetDto) {
    return this.service.create(tenant, dto);
  }

  @Patch('reorder')
  @RequirePermission('note_presets.manage')
  reorder(
    @GetTenant() tenant: TenantContext,
    @Body() dto: ReorderNotePresetsDto,
  ) {
    return this.service.reorder(tenant, dto);
  }

  @Patch(':id')
  @RequirePermission('note_presets.manage')
  update(
    @GetTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateNotePresetDto,
  ) {
    return this.service.update(tenant, id, dto);
  }

  @Delete(':id')
  @RequirePermission('note_presets.manage')
  remove(@GetTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.service.remove(tenant, id);
  }
}
