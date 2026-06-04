export type BackupComponentStatus = 'healthy' | 'degraded' | 'unknown';

export interface DatabaseBackupInfo {
  status: BackupComponentStatus;
  canConnect: boolean;
  tablesReachable: boolean;
  tenantCount: number;
  lastCheckedAt: string;
  message: string;
}

export interface RedisBackupInfo {
  status: BackupComponentStatus;
  canConnect: boolean;
  lastCheckedAt: string;
  message: string;
}

export interface BackupStatusReport {
  overall: BackupComponentStatus;
  checkedAt: string;
  database: DatabaseBackupInfo;
  redis: RedisBackupInfo;
  supabaseBackupNote: string;
  recommendations: string[];
}