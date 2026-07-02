import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AsyncContextService } from '../../core/logger/context/async-context.service';

export const SUPABASE_CLIENT = 'SUPABASE_CLIENT';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: SUPABASE_CLIENT,
      inject: [ConfigService, AsyncContextService],
      useFactory: (config: ConfigService, asyncContext: AsyncContextService): SupabaseClient => {
        return createClient(
          config.getOrThrow<string>('SUPABASE_URL'),
          config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
          {
            global: {
              // Counts every PostgREST/RPC call against the active request's
              // AsyncLocalStorage context for the lightweight perf tracker.
              fetch: (...args: Parameters<typeof fetch>) => {
                asyncContext.incrementDbQueryCount();
                return fetch(...args);
              },
            },
          },
        );
      },
    },
  ],
  exports: [SUPABASE_CLIENT],
})
export class SupabaseModule {}