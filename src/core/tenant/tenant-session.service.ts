import {
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../../shared/database/pg-pool.module';
import { TenantContext } from './tenant-context';

/**
 * Pins RLS enforcement to the database session via `SET LOCAL app.tenant_id`,
 * for the hot-path repositories migrated onto `PgPoolModule`. This is the only
 * mechanism in the codebase that makes RLS binding for backend-originated
 * queries — `SUPABASE_SERVICE_ROLE_KEY` (used by the rest of the app via
 * `supabase.module.ts`) bypasses RLS entirely, so repositories still on the
 * Supabase client rely on `ScopedRepository`'s `.eq('tenant_id', ...)` filter
 * as their only guarantee, not this service.
 */
@Injectable()
export class TenantSessionService {
  constructor(@Optional() @Inject(PG_POOL) private readonly pool: Pool | null) {}

  async runInTenantContext<T>(
    tenant: TenantContext,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    if (!this.pool) {
      // DATABASE_URL isn't provisioned yet (see STATUS.md §78/§79) — fails
      // loudly here, at the moment a caller actually opts into the pooled
      // path, instead of crashing app boot for every tenant via PgPoolModule.
      throw new ServiceUnavailableException(
        'TenantSessionService has no PG_POOL configured — DATABASE_URL is missing. ' +
          'Do not enable any pooled-write feature flag until it is provisioned.',
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // set_config(..., true) scopes the value to the current transaction
      // only (equivalent to SET LOCAL) — cleared automatically on COMMIT or
      // ROLLBACK so it can never leak onto the next transaction that reuses
      // this pooled connection.
      await client.query('SELECT set_config($1, $2, true)', [
        'app.tenant_id',
        tenant.tenantId ?? '',
      ]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
