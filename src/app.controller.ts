import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { Public } from './shared/decorators/public.decorator';
import { CurrentUser } from './shared/decorators/current-user.decorator';
import { SUPABASE_CLIENT } from './shared/supabase/supabase.module';
import { JwtPayload } from './shared/types/jwt-payload.type';
import { PermissionGuard } from './core/permissions/permission.guard';
import { RequirePermission } from './core/permissions/require-permission.decorator';
import { TenantGuard } from './core/tenant/tenant.guard';

@Controller()
export class AppController {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  @Public()
  @Get('health')
  health(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('health/db')
  async dbHealth(): Promise<{ status: string; connected: boolean }> {
    const { error } = await this.supabase
      .from('tenants')
      .select('id')
      .limit(1);

    return { status: error ? 'error' : 'ok', connected: !error };
  }

  @Get('me')
  me(@CurrentUser() user: JwtPayload): JwtPayload {
    return user;
  }

  @UseGuards(TenantGuard, PermissionGuard)
  @RequirePermission('invoice.cancel.branch')
  @Get('test-permission')
  testPermission(@CurrentUser() user: JwtPayload): { message: string; role: string } {
    return {
      message: 'Permission granted',
      role: user.role,
    };
  }
}