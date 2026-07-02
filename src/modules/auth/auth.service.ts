import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { AuditService } from '../../core/audit/audit.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RevokeSessionDto } from './dto/revoke-session.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

const ACTIVITY_SECTION_TO_BUSINESS_TYPE: Record<string, string> = {
  restaurant: 'restaurant',
  cafe: 'cafe',
  fastFood: 'restaurant',
  bakery: 'restaurant',
  juice: 'cafe',
  foodTruck: 'restaurant',
  grocery: 'retail',
  supermarket: 'retail',
  perfume: 'retail',
  stationery: 'retail',
  gifts: 'retail',
  menClothing: 'retail',
  womenClothing: 'retail',
  shoes: 'retail',
  accessories: 'retail',
  tailoring: 'services',
  pharmacy: 'retail',
  medical: 'services',
  clinic: 'services',
  optics: 'retail',
  supplements: 'retail',
  barber: 'services',
  womenSalon: 'services',
  spa: 'services',
  cosmetics: 'retail',
  carWash: 'services',
  laundry: 'services',
  phoneFix: 'workshop',
  carWorkshop: 'workshop',
  homeServices: 'services',
  phones: 'retail',
  gadgets: 'retail',
  gaming: 'retail',
  furniture: 'retail',
  homeware: 'retail',
  flowers: 'retail',
  pets: 'retail',
};

@Injectable()
export class AuthService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  private async getUserPermissions(role: string): Promise<string[]> {
    const { data } = await this.supabase
      .from('role_permissions')
      .select('permission_key')
      .eq('role', role)
      .eq('is_granted', true);

    return (data ?? []).map((r: { permission_key: string }) => r.permission_key);
  }

  private async getTenantFeatures(tenantId: string | null): Promise<string[]> {
    if (!tenantId) return [];

    const { data: subscription } = await this.supabase
      .from('subscriptions')
      .select('plan_id')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .maybeSingle();

    const planId = subscription?.plan_id ?? null;

    const planFeatures: string[] = [];
    if (planId) {
      const { data: pf } = await this.supabase
        .from('plan_features')
        .select('feature_key')
        .eq('plan_id', planId)
        .eq('is_enabled', true);
      (pf ?? []).forEach((r: { feature_key: string }) => planFeatures.push(r.feature_key));
    }

    const { data: overrides } = await this.supabase
      .from('tenant_feature_overrides')
      .select('feature_key, is_enabled')
      .eq('tenant_id', tenantId);

    const featureMap = new Map<string, boolean>();
    planFeatures.forEach((key) => featureMap.set(key, true));
    (overrides ?? []).forEach((o: { feature_key: string; is_enabled: boolean | null }) => {
      if (o.is_enabled !== null) featureMap.set(o.feature_key, o.is_enabled);
    });

    return Array.from(featureMap.entries())
      .filter(([, enabled]) => enabled)
      .map(([key]) => key);
  }

  private async getTenantBusinessType(
    tenantId: string | null,
  ): Promise<{ business_type: string | null; activity: string | null }> {
    if (!tenantId) return { business_type: null, activity: null };

    const { data } = await this.supabase
      .from('tenants')
      .select('business_type, activity')
      .eq('id', tenantId)
      .is('deleted_at', null)
      .single();

    return {
      business_type: data?.business_type ?? null,
      activity: data?.activity ?? null,
    };
  }

  async login(dto: LoginDto, ip: string, userAgent: string) {
    const { data: user, error } = await this.supabase
      .from('users')
      .select('id, email, password_hash, role, tenant_id, is_active, name')
      .eq('email', dto.email)
      .is('deleted_at', null)
      .single();

    if (error || !user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.is_active) {
      throw new ForbiddenException('Account is inactive');
    }

    const valid = await bcrypt.compare(dto.password, user.password_hash);
    if (!valid) {
      await this.auditService.log({
        tenant_id: user.tenant_id,
        actor_id: user.id,
        actor_role: user.role,
        action: 'auth.login_failed',
        resource_type: 'auth',
        resource_id: user.id,
        ip_address: ip,
        device: userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const { data: session } = await this.supabase
      .from('device_sessions')
      .insert({
        user_id: user.id,
        tenant_id: user.tenant_id,
        device_name: dto.device_name,
        device_type: 'web',
        ip_address: ip,
        user_agent: userAgent,
        last_active_at: new Date().toISOString(),
        is_revoked: false,
      })
      .select('id')
      .single();

    const { business_type, activity } = await this.getTenantBusinessType(user.tenant_id);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenant_id: user.tenant_id,
      session_id: session!.id,
      business_type,
      activity,
    };

    const access_token = this.jwtService.sign(payload);
    const refresh_token = crypto.randomBytes(64).toString('hex');
    const token_hash = crypto
      .createHash('sha256')
      .update(refresh_token)
      .digest('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.supabase.from('refresh_tokens').insert({
      user_id: user.id,
      session_id: session!.id,
      token_hash,
      expires_at: expiresAt.toISOString(),
      is_used: false,
    });

    await this.auditService.log({
      tenant_id: user.tenant_id,
      actor_id: user.id,
      actor_role: user.role,
      action: 'auth.login',
      resource_type: 'auth',
      resource_id: user.id,
      ip_address: ip,
      device: userAgent,
    });

    const [permissions, features] = await Promise.all([
      this.getUserPermissions(user.role),
      this.getTenantFeatures(user.tenant_id),
    ]);

    return {
      access_token,
      refresh_token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenant_id: user.tenant_id,
        session_id: session!.id,
        business_type,
        activity,
        permissions,
        features,
      },
    };
  }

  async register(dto: RegisterDto, ip: string, userAgent: string) {
    const { data: existing } = await this.supabase
      .from('users')
      .select('id')
      .eq('email', dto.email)
      .is('deleted_at', null)
      .maybeSingle();

    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const { data: plan, error: planError } = await this.supabase
      .from('plans')
      .select('id, trial_days')
      .eq('is_active', true)
      .order('price_monthly', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (planError || !plan) {
      throw new ServiceUnavailableException('No active subscription plan is configured');
    }

    const businessType = ACTIVITY_SECTION_TO_BUSINESS_TYPE[dto.activity] ?? 'other';
    const language = dto.language ?? 'ar';
    const currency = dto.currency ?? 'SAR';

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + plan.trial_days);

    const { data: tenant, error: tenantError } = await this.supabase
      .from('tenants')
      .insert({
        name: dto.businessName,
        business_type: businessType,
        activity: dto.activity,
        status: 'trial',
        trial_ends_at: trialEndsAt.toISOString(),
        default_language: language,
        phone: dto.phone,
        email: dto.email,
        address: dto.city ?? null,
        currency,
      })
      .select('id')
      .single();

    if (tenantError || !tenant) {
      throw new ServiceUnavailableException('Failed to create tenant');
    }

    try {
      const password_hash = await bcrypt.hash(dto.password, 12);

      const { data: user, error: userError } = await this.supabase
        .from('users')
        .insert({
          tenant_id: tenant.id,
          email: dto.email,
          password_hash,
          name: dto.ownerName,
          role: 'owner',
          language,
          is_active: true,
        })
        .select('id, email, name, role, tenant_id')
        .single();

      if (userError || !user) {
        throw new ServiceUnavailableException('Failed to create owner account');
      }

      const { error: branchError } = await this.supabase.from('branches').insert({
        tenant_id: tenant.id,
        name: dto.branchName?.trim() || `${dto.businessName} - الفرع الرئيسي`,
        address: dto.city ?? null,
        is_active: true,
      });

      if (branchError) {
        throw new ServiceUnavailableException('Failed to create branch');
      }

      const { error: subError } = await this.supabase.from('subscriptions').insert({
        tenant_id: tenant.id,
        plan_id: plan.id,
        status: 'trial',
        billing_cycle: 'monthly',
        started_at: new Date().toISOString(),
        trial_ends_at: trialEndsAt.toISOString(),
      });

      if (subError) {
        throw new ServiceUnavailableException('Failed to create subscription');
      }

      const { data: session } = await this.supabase
        .from('device_sessions')
        .insert({
          user_id: user.id,
          tenant_id: tenant.id,
          device_name: dto.device_name ?? 'Signup',
          device_type: 'web',
          ip_address: ip,
          user_agent: userAgent,
          last_active_at: new Date().toISOString(),
          is_revoked: false,
        })
        .select('id')
        .single();

      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        tenant_id: user.tenant_id,
        session_id: session!.id,
        business_type: businessType,
        activity: dto.activity,
      };

      const access_token = this.jwtService.sign(payload);
      const refresh_token = crypto.randomBytes(64).toString('hex');
      const token_hash = crypto.createHash('sha256').update(refresh_token).digest('hex');

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await this.supabase.from('refresh_tokens').insert({
        user_id: user.id,
        session_id: session!.id,
        token_hash,
        expires_at: expiresAt.toISOString(),
        is_used: false,
      });

      await this.auditService.log({
        tenant_id: tenant.id,
        actor_id: user.id,
        actor_role: user.role,
        action: 'auth.register',
        resource_type: 'tenant',
        resource_id: tenant.id,
        ip_address: ip,
        device: userAgent,
      });

      const [permissions, features] = await Promise.all([
        this.getUserPermissions(user.role),
        this.getTenantFeatures(tenant.id),
      ]);

      return {
        access_token,
        refresh_token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          tenant_id: user.tenant_id,
          session_id: session!.id,
          business_type: businessType,
          activity: dto.activity,
          permissions,
          features,
        },
      };
    } catch (err) {
      await this.supabase.from('tenants').delete().eq('id', tenant.id);
      throw err;
    }
  }

  async refresh(dto: RefreshDto, ip: string, userAgent: string) {
    const token_hash = crypto
      .createHash('sha256')
      .update(dto.refresh_token)
      .digest('hex');

    const { data: tokenRecord } = await this.supabase
      .from('refresh_tokens')
      .select('id, user_id, session_id, is_used, expires_at')
      .eq('token_hash', token_hash)
      .single();

    if (!tokenRecord) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (tokenRecord.is_used) {
      await this.supabase
        .from('device_sessions')
        .update({ is_revoked: true })
        .eq('id', tokenRecord.session_id);

      await this.auditService.log({
        tenant_id: null,
        actor_id: tokenRecord.user_id,
        actor_role: 'unknown',
        action: 'auth.refresh_violation',
        resource_type: 'auth',
        resource_id: tokenRecord.id,
        ip_address: ip,
        device: userAgent,
      });

      throw new UnauthorizedException('Token reuse detected. Session revoked.');
    }

    if (new Date(tokenRecord.expires_at) < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const { data: session } = await this.supabase
      .from('device_sessions')
      .select('id, is_revoked, user_id, tenant_id')
      .eq('id', tokenRecord.session_id)
      .single();

    if (!session || session.is_revoked) {
      throw new UnauthorizedException('Session revoked');
    }

    const { data: user } = await this.supabase
      .from('users')
      .select('id, email, role, tenant_id')
      .eq('id', tokenRecord.user_id)
      .is('deleted_at', null)
      .single();

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    await this.supabase
      .from('refresh_tokens')
      .update({ is_used: true })
      .eq('id', tokenRecord.id);

    const { business_type, activity } = await this.getTenantBusinessType(user.tenant_id);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenant_id: user.tenant_id,
      session_id: session.id,
      business_type,
      activity,
    };

    const access_token = this.jwtService.sign(payload);
    const new_refresh_token = crypto.randomBytes(64).toString('hex');
    const new_hash = crypto
      .createHash('sha256')
      .update(new_refresh_token)
      .digest('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.supabase.from('refresh_tokens').insert({
      user_id: user.id,
      session_id: session.id,
      token_hash: new_hash,
      expires_at: expiresAt.toISOString(),
      is_used: false,
    });

    await this.supabase
      .from('device_sessions')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', session.id);

    return { access_token, refresh_token: new_refresh_token };
  }

  async logout(
    userId: string,
    sessionId: string,
    ip: string,
    userAgent: string,
    role: string,
    tenantId: string | null,
  ) {
    await this.supabase
      .from('refresh_tokens')
      .update({ is_used: true })
      .eq('session_id', sessionId)
      .eq('is_used', false);

    await this.supabase
      .from('device_sessions')
      .update({ is_revoked: true })
      .eq('id', sessionId);

    await this.auditService.log({
      tenant_id: tenantId,
      actor_id: userId,
      actor_role: role,
      action: 'auth.logout',
      resource_type: 'auth',
      resource_id: userId,
      ip_address: ip,
      device: userAgent,
    });

    return { message: 'Logged out successfully' };
  }

  async me(userId: string) {
    const { data: user, error } = await this.supabase
      .from('users')
      .select('id, name, email, role, tenant_id, is_active, created_at')
      .eq('id', userId)
      .is('deleted_at', null)
      .single();

    if (error || !user) {
      throw new UnauthorizedException('User not found');
    }

    const [permissions, features, { business_type, activity }] = await Promise.all([
      this.getUserPermissions(user.role),
      this.getTenantFeatures(user.tenant_id),
      this.getTenantBusinessType(user.tenant_id),
    ]);

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenant_id: user.tenant_id,
      is_active: user.is_active,
      created_at: user.created_at,
      business_type,
      activity,
      permissions,
      features,
    };
  }

  async revokeSession(
    dto: RevokeSessionDto,
    actorId: string,
    actorRole: string,
    tenantId: string | null,
    ip: string,
    userAgent: string,
  ) {
    let sessionQuery = this.supabase
      .from('device_sessions')
      .select('id, user_id')
      .eq('id', dto.session_id);

    // Superadmin can revoke any session cross-tenant; regular users are scoped to their tenant
    if (actorRole !== 'superadmin' && tenantId) {
      sessionQuery = sessionQuery.eq('tenant_id', tenantId);
    }

    const { data: session } = await sessionQuery.single();

    if (!session) {
      throw new UnauthorizedException('Session not found');
    }

    if (actorRole !== 'superadmin' && session.user_id !== actorId) {
      throw new ForbiddenException('Cannot revoke another user session');
    }

    await this.supabase
      .from('device_sessions')
      .update({ is_revoked: true })
      .eq('id', dto.session_id);

    await this.supabase
      .from('refresh_tokens')
      .update({ is_used: true })
      .eq('session_id', dto.session_id);

    await this.auditService.log({
      tenant_id: tenantId,
      actor_id: actorId,
      actor_role: actorRole,
      action: 'auth.revoke',
      resource_type: 'device_session',
      resource_id: dto.session_id,
      ip_address: ip,
      device: userAgent,
    });

    return { message: 'Session revoked' };
  }

  async getSessions(userId: string) {
    const { data: sessions, error } = await this.supabase
      .from('device_sessions')
      .select('id, device_name, device_type, ip_address, last_active_at, is_revoked, created_at, user_id, tenant_id, user:users!device_sessions_user_id_fkey(name, email), tenant:tenants!device_sessions_tenant_id_fkey(name)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (sessions ?? []).map((s: any) => ({
      id: s.id,
      device_name: s.device_name,
      device_type: s.device_type,
      ip_address: s.ip_address,
      last_active_at: s.last_active_at,
      is_revoked: s.is_revoked,
      created_at: s.created_at,
      user_id: s.user_id,
      tenant_id: s.tenant_id,
      user_name: s.user?.name ?? null,
      user_email: s.user?.email ?? null,
      tenant_name: s.tenant?.name ?? null,
    }));
  }
}