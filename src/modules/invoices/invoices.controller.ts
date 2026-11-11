import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';
import { UpdateInvoiceNoteDto } from './dto/update-invoice-note.dto';
import { HoldOrderDto } from './dto/hold-order.dto';
import { UpdateHeldVisibilityDto } from './dto/update-held-visibility.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { BranchScoped } from '../../core/security/branch-scoped.decorator';
import { EffectiveBranchId } from '../../core/security/effective-branch-id.decorator';
import { Request } from 'express';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  // Branch Domain Batch 1, B2 (Owner-approved) — write path. A restricted
  // cashier's dto.branch_id is validated against their own branch (any
  // mismatch is now a hard reject, matching the read side) rather than
  // trusted outright; Central must still supply a concrete branch — there
  // is no tenant-wide "create for no particular branch."
  @Post()
  @RequirePermission('invoice.create')
  @BranchScoped({ source: 'body', mode: 'write' })
  async create(
    @Body() dto: CreateInvoiceDto,
    @GetTenant() tenant: TenantContext,
    @EffectiveBranchId() effectiveBranchId: string | null | undefined,
    @Req() req: Request,
  ) {
    if (!effectiveBranchId) {
      throw new BadRequestException(
        'branch_id is required to create an invoice',
      );
    }
    const user = req.user as { sub: string; role: string };
    const ip = (req.headers['x-forwarded-for'] as string) ?? req.ip ?? '';
    const device = req.headers['user-agent'] ?? '';

    return this.invoicesService.create(
      tenant,
      dto,
      user.sub,
      user.role,
      effectiveBranchId,
      dto.shift_id,
      ip,
      device,
    );
  }

  // Branch Domain Batch 1, B2 (Owner-approved) — Restricted actors are now
  // forced to their own branch (or rejected on an explicit mismatch)
  // instead of the previous unscoped tenant-wide read; Central retains its
  // existing tenant-wide-by-default / explicit-branch-narrows behavior.
  @Get()
  @RequirePermission('invoice.view')
  @BranchScoped()
  async findAll(
    @GetTenant() tenant: TenantContext,
    @EffectiveBranchId() effectiveBranchId: string | null | undefined,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
    @Query('status') status?: string,
  ) {
    return this.invoicesService.findAll(
      tenant,
      effectiveBranchId ?? undefined,
      dateFrom,
      dateTo,
      page,
      perPage,
      status,
    );
  }

  // Registered before ':id' — otherwise Nest would route
  // GET /invoices/held (and its sub-paths) into the :id handler instead,
  // same gotcha already documented elsewhere in this codebase (e.g.
  // item-barcodes' lookup/:barcode vs :id).
  @Post('held')
  @RequirePermission('invoice.create')
  async holdOrder(
    @Body() dto: HoldOrderDto,
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string; role: string };
    return this.invoicesService.holdOrder(tenant, dto, user.sub, user.role);
  }

  // Branch Domain Batch 1, B2 (Owner-approved) — held orders are inherently
  // per-branch (a held cart belongs to one register/branch); Central must
  // still supply an explicit branch_id, same as before this change, just
  // now validated as genuinely belonging to the tenant rather than trusted
  // as-is. Restricted actors are forced to their own branch.
  @Get('held')
  @RequirePermission('invoice.view')
  @BranchScoped()
  async listHeldOrders(
    @GetTenant() tenant: TenantContext,
    @EffectiveBranchId() effectiveBranchId: string | null | undefined,
    @Req() req: Request,
  ) {
    if (!effectiveBranchId) {
      throw new BadRequestException(
        'branch_id is required to list held orders',
      );
    }
    const user = req.user as { sub: string; role: string };
    return this.invoicesService.listHeldOrders(
      tenant,
      effectiveBranchId,
      user.sub,
    );
  }

  @Get('held/:id')
  @RequirePermission('invoice.view')
  async getHeldOrder(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.invoicesService.getHeldOrder(tenant, id);
  }

  @Patch('held/:id/visibility')
  @RequirePermission('invoice.create')
  async updateHeldVisibility(
    @Param('id') id: string,
    @Body() dto: UpdateHeldVisibilityDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.invoicesService.updateHeldVisibility(
      tenant,
      id,
      dto.held_visibility,
    );
  }

  @Delete('held/:id')
  @RequirePermission('invoice.cancel')
  async cancelHeldOrder(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string; role: string };
    return this.invoicesService.cancelHeldOrder(
      tenant,
      id,
      user.sub,
      user.role,
    );
  }

  @Get(':id')
  @RequirePermission('invoice.view')
  async findById(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.invoicesService.findById(tenant, id);
  }

  // G6 — edits ONLY the non-financial note, completed invoices included.
  @Patch(':id/note')
  @RequirePermission('invoice.create')
  async updateNote(
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceNoteDto,
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string; role: string };
    const ip = (req.headers['x-forwarded-for'] as string) ?? req.ip ?? '';
    const device = req.headers['user-agent'] ?? '';
    return this.invoicesService.updateNote(
      tenant,
      id,
      dto.note,
      user.sub,
      user.role,
      ip,
      device,
    );
  }

  @Patch(':id/cancel')
  @RequirePermission('invoice.cancel')
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelInvoiceDto,
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string; role: string };
    const ip = (req.headers['x-forwarded-for'] as string) ?? req.ip ?? '';
    const device = req.headers['user-agent'] ?? '';

    return this.invoicesService.cancel(
      tenant,
      id,
      dto,
      user.sub,
      user.role,
      ip,
      device,
    );
  }
}
