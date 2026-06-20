import { Controller, Get, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { Public } from './shared/decorators/public.decorator';
import { CurrentUser } from './shared/decorators/current-user.decorator';
import { SUPABASE_CLIENT } from './shared/supabase/supabase.module';
import { JwtPayload } from './shared/types/jwt-payload.type';

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
}