import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { PlansService } from './plans.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { SuperAdminGuard } from '../superadmin/guards/superadmin.guard';
import { SkipTenant } from '../../core/tenant/skip-tenant.decorator';
import { isPlatformAdmin } from '../../core/security/platform-identity';

@Controller('plans')
@UseGuards(JwtAuthGuard)
@SkipTenant()
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  // Read access: any authenticated user, but only ACTIVE plans. A superadmin
  // (verified JWT roles) also sees deactivated plans, for management.
  private isSuperAdmin(req: Request): boolean {
    return isPlatformAdmin(
      req.user as
        | {
            role?: string;
            roles?: string[];
            platform_admin?: boolean;
            tenant_id?: string | null;
          }
        | undefined,
    );
  }

  @Get()
  findAll(@Req() req: Request) {
    return this.plansService.findAll(this.isSuperAdmin(req));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: Request) {
    return this.plansService.findOne(id, this.isSuperAdmin(req));
  }

  @Post()
  @UseGuards(SuperAdminGuard)
  create(@Body() dto: CreatePlanDto) {
    return this.plansService.create(dto);
  }

  @Patch(':id')
  @UseGuards(SuperAdminGuard)
  update(@Param('id') id: string, @Body() dto: Partial<CreatePlanDto>) {
    return this.plansService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(SuperAdminGuard)
  remove(@Param('id') id: string) {
    return this.plansService.remove(id);
  }
}
