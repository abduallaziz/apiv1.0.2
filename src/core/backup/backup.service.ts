import { Injectable, Inject } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { SupabaseClient } from '@supabase/supabase-js';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  BackupStatusReport,
  BackupComponentStatus,
  DatabaseBackupInfo,
  RedisBackupInfo,
} from './interfaces/backup-status.interface';
import { LoggerService } from '../logger/logger.service';

@Injectable()
export class BackupService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    @InjectQueue('dunning') private readonly dunningQueue: Queue,
    private readonly logger: LoggerService,
  ) {}

  async getBackupStatus(): Promise<BackupStatusReport> {
    const checkedAt = new Date().toISOString();

    const [dbInfo, redisInfo] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    const overall = this.resolveOverall(dbInfo.status, redisInfo.status);
    const recommendations = this.buildRecommendations(dbInfo, redisInfo);

    return {
      overall,
      checkedAt,
      database: dbInfo,
      redis: redisInfo,
      supabaseBackupNote:
        'Supabase performs automatic daily backups. Point-in-time recovery (PITR) is available on Pro plan and above. Verify backup retention at: https://supabase.com/dashboard/project/_/database/backups',
      recommendations,
    };
  }

  async runDailyIntegrityCheck(): Promise<void> {
    this.logger.info('backup.integrity_check.start', { module: 'BackupService' });

    try {
      const report = await this.getBackupStatus();

      if (report.overall !== 'healthy') {
        this.logger.warn('backup.integrity_check.degraded', {
          module: 'BackupService',
          meta: {
            overall: report.overall,
            dbStatus: report.database.status,
            redisStatus: report.redis.status,
            recommendations: report.recommendations,
          },
        });
      } else {
        this.logger.info('backup.integrity_check.ok', {
          module: 'BackupService',
          meta: { tenantCount: report.database.tenantCount },
        });
      }
    } catch (err) {
      this.logger.error(
        'backup.integrity_check.failed',
        err instanceof Error ? err : new Error(String(err)),
        { module: 'BackupService' },
      );
    }
  }

  private async checkDatabase(): Promise<DatabaseBackupInfo> {
    const lastCheckedAt = new Date().toISOString();

    try {
      const { data: tenants, error: tenantsError } = await this.supabase
        .from('tenants')
        .select('id')
        .is('deleted_at', null)
        .limit(1000);

      if (tenantsError) {
        return {
          status: 'degraded',
          canConnect: false,
          tablesReachable: false,
          tenantCount: 0,
          lastCheckedAt,
          message: `DB connection error: ${tenantsError.message}`,
        };
      }

      const { error: usersError } = await this.supabase
        .from('users')
        .select('id')
        .limit(1);

      const { error: ordersError } = await this.supabase
        .from('orders')
        .select('id')
        .limit(1);

      const tablesReachable = !usersError && !ordersError;
      const tenantCount = tenants?.length ?? 0;

      return {
        status: tablesReachable ? 'healthy' : 'degraded',
        canConnect: true,
        tablesReachable,
        tenantCount,
        lastCheckedAt,
        message: tablesReachable
          ? `Database healthy. ${tenantCount} active tenants.`
          : 'Some tables unreachable.',
      };
    } catch (err) {
      return {
        status: 'unknown',
        canConnect: false,
        tablesReachable: false,
        tenantCount: 0,
        lastCheckedAt,
        message: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async checkRedis(): Promise<RedisBackupInfo> {
    const lastCheckedAt = new Date().toISOString();

    try {
      await this.dunningQueue.getWaitingCount();

      return {
        status: 'healthy',
        canConnect: true,
        lastCheckedAt,
        message: 'Redis reachable via BullMQ.',
      };
    } catch (err) {
      return {
        status: 'degraded',
        canConnect: false,
        lastCheckedAt,
        message: `Redis unreachable: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private resolveOverall(
    dbStatus: BackupComponentStatus,
    redisStatus: BackupComponentStatus,
  ): BackupComponentStatus {
    if (dbStatus === 'healthy' && redisStatus === 'healthy') return 'healthy';
    if (dbStatus === 'unknown' || redisStatus === 'unknown') return 'unknown';
    return 'degraded';
  }

  private buildRecommendations(
    db: DatabaseBackupInfo,
    redis: RedisBackupInfo,
  ): string[] {
    const recs: string[] = [];

    if (!db.canConnect) {
      recs.push(
        'CRITICAL: Database unreachable. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.',
      );
    }

    if (db.canConnect && !db.tablesReachable) {
      recs.push('WARNING: Some tables are unreachable. Run pending migrations.');
    }

    if (!redis.canConnect) {
      recs.push(
        'WARNING: Redis unreachable. BullMQ queues will not process jobs. Check REDIS_URL.',
      );
    }

    if (db.status === 'healthy' && redis.status === 'healthy') {
      recs.push('All systems healthy. Verify Supabase backup retention in dashboard.');
      recs.push('Ensure PITR (Point-in-Time Recovery) is enabled on Supabase Pro plan.');
    }

    return recs;
  }
}