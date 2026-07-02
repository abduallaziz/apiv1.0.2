import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../shared/supabase/supabase.module';
import { MetricsService } from '../metrics.service';

@Injectable()
export class BusinessCollector implements OnModuleInit {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly metricsService: MetricsService,
  ) {}

  onModuleInit(): void {
    void this.refreshActiveTenants();
    setInterval(() => void this.refreshActiveTenants(), 5 * 60 * 1000);
  }

  private async refreshActiveTenants(): Promise<void> {
    try {
      const { count } = await this.supabase
        .from('tenants')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .is('deleted_at', null);

      if (count !== null) {
        this.metricsService.setActiveTenants(count);
      }
    } catch {
      // Non-critical
    }
  }
}