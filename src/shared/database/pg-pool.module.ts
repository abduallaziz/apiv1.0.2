import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

export const PG_POOL = 'PG_POOL';

const poolLogger = new Logger('PgPool');

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool | null => {
        // Must point at Supavisor in TRANSACTION mode (not session mode, not
        // the direct Postgres port) — transaction-mode pooling is what lets
        // this pool survive horizontal scaling of the Nest app. Session-mode
        // pooling would pin transactions to a fixed connection per client and
        // defeat the point of pooling under concurrent tenants.
        //
        // Deliberately non-throwing: DATABASE_URL is not provisioned in any
        // environment yet (see STATUS.md §78/§79). Using getOrThrow here would
        // crash the entire app at boot the moment this module is imported,
        // for every tenant, not just the not-yet-migrated hot paths. Instead,
        // absence is logged loudly and the pool is null — only the specific
        // pooled-write call sites (gated behind their own feature flags) fail,
        // and only if actually invoked.
        const connectionString = config.get<string>('DATABASE_URL');
        if (!connectionString) {
          poolLogger.warn(
            'DATABASE_URL is not set — PG_POOL is disabled. Any code path ' +
              'that requires TenantSessionService/PgPoolModule will throw ' +
              'when invoked, not at boot. Provision the Supavisor transaction-mode ' +
              'connection string before enabling any pooled-write feature flag.',
          );
          return null;
        }
        const pool = new Pool({
          connectionString,
          max: config.get<number>('PG_POOL_MAX') ?? 10,
          idleTimeoutMillis: 30_000,
        });
        pool.on('error', (err) => {
          poolLogger.error(`Idle client error: ${err.message}`);
        });
        return pool;
      },
    },
  ],
  exports: [PG_POOL],
})
export class PgPoolModule {}
