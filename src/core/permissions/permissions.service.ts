import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { RedisCacheService } from '../cache/redis-cache.service';

// role_permissions has no tenant_id — permissions are role-scoped system-wide.
// Cache is keyed by role; TTL is 10 minutes.
const PERMISSIONS_TTL = 600;
const cacheKey = (role: string) => `permissions:role:${role}`;

@Injectable()
export class PermissionsService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly cache: RedisCacheService,
  ) {}

  async hasPermission(role: string, permissionKey: string): Promise<boolean> {
    const granted = await this.getGrantedSet(role);
    return granted.has(permissionKey);
  }

  async getRolePermissions(role: string): Promise<string[]> {
    const granted = await this.getGrantedSet(role);
    return Array.from(granted);
  }

  async invalidateRole(role: string): Promise<void> {
    await this.cache.del(cacheKey(role));
  }

  private async getGrantedSet(role: string): Promise<Set<string>> {
    const key = cacheKey(role);

    const cached = await this.cache.get<string[]>(key);
    if (cached) return new Set(cached);

    const permissions = await this.fetchFromDb(role);
    await this.cache.set(key, permissions, PERMISSIONS_TTL);
    return new Set(permissions);
  }

  private async fetchFromDb(role: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('role_permissions')
      .select('permission_key')
      .eq('role', role)
      .eq('is_granted', true);

    if (error || !data) return [];
    return data.map((row) => row.permission_key);
  }
}
