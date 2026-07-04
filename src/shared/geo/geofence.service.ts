import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

export interface GeofenceCheckResult {
  allowed: boolean;
  // Which zone matched (or would have matched), for audit/debugging. null when no zone is
  // configured at all — in that case `allowed` is true (opt-in feature, not enforced).
  matchedZone: 'employee_override' | 'branch_default' | null;
}

@Injectable()
export class GeofenceService {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

  // Haversine formula — great-circle distance between two lat/lng points, in meters.
  private distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async checkLocation(
    tenantId: string,
    userId: string,
    lat: number,
    lng: number,
  ): Promise<GeofenceCheckResult> {
    const today = new Date().toISOString().substring(0, 10);

    const { data: zones, error: zonesErr } = await this.supabase
      .from('employee_geofences')
      .select('center_lat, center_lng, radius_m, valid_from, valid_to')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId);
    if (zonesErr) throw zonesErr;

    const activeZones = (zones ?? []).filter(
      (z) => (!z.valid_from || z.valid_from <= today) && (!z.valid_to || z.valid_to >= today),
    );

    if (activeZones.length > 0) {
      const withinAny = activeZones.some(
        (z) => this.distanceMeters(lat, lng, z.center_lat, z.center_lng) <= z.radius_m,
      );
      return { allowed: withinAny, matchedZone: 'employee_override' };
    }

    // No employee-specific zone active today — fall back to today's scheduled branch,
    // then that branch's default geofence.
    const { data: schedule } = await this.supabase
      .from('work_schedules')
      .select('branch_id')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .eq('scheduled_date', today)
      .not('branch_id', 'is', null)
      .maybeSingle();

    if (!schedule?.branch_id) return { allowed: true, matchedZone: null };

    const { data: branch, error: branchErr } = await this.supabase
      .from('branches')
      .select('geofence_lat, geofence_lng, geofence_radius_m')
      .eq('id', schedule.branch_id)
      .maybeSingle();
    if (branchErr) throw branchErr;

    if (!branch?.geofence_lat || !branch?.geofence_lng || !branch?.geofence_radius_m) {
      return { allowed: true, matchedZone: null };
    }

    const within =
      this.distanceMeters(lat, lng, branch.geofence_lat, branch.geofence_lng) <= branch.geofence_radius_m;
    return { allowed: within, matchedZone: 'branch_default' };
  }
}
