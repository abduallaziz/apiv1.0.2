import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';

export type EntitlementPhase = 'trial' | 'active' | 'grace' | 'locked' | 'none';

export interface Entitlements {
  tenant_id: string;
  /** True when the subscription rules are actually ENFORCED for this tenant (rollout flag). */
  enforced: boolean;
  phase: EntitlementPhase;
  /** True when the plan ended: the tenant is fully suspended (only the subscription screens stay reachable). */
  locked: boolean;
  /** Whole days left until the end (0 on the last day / once ended). null = no end date. */
  days_left: number | null;
  /** True during the last 30 days: the countdown banner is shown. */
  show_countdown: boolean;
  ends_at: string | null;
  subscription_id: string | null;
  status: string | null;
  billing_cycle: string | null;
  plan: { id: string; name: string } | null;
  /** Plan limits + purchased/granted extra users, branches and POS registers. -1 = unlimited. */
  limits: { max_users: number; max_branches: number; max_pos: number };
  /** Features the tenant may use: plan features + active feature add-ons, after super-admin overrides. */
  features: string[];
}

const TTL_MS = 20_000;
const DAY_MS = 86_400_000;
const COUNTDOWN_DAYS = 30;

/** Routes that stay reachable while the subscription is locked (renewal, purchase, sign-out, health). */
const LOCK_EXEMPT =
  /(^|\/)(subscriptions|billing|plans|entitlements|auth|health|webhooks?)(\/|\?|$)/;

type SubRow = {
  id: string;
  plan_id: string;
  status: string;
  billing_cycle: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  grace_period_ends_at: string | null;
};

/**
 * ONE place that answers "what may this tenant use right now": limits, features and whether the plan has
 * ended. Everything (limit checks, the feature guard, the lock guard, the subscription screen) reads from it.
 * Cached for a few seconds because the TenantGuard consults it on every request.
 *
 * Enforcement (the 402 lock) is behind SUBSCRIPTION_ENFORCEMENT: unset/"off" = nothing is enforced,
 * "all" = every tenant, otherwise a comma-separated list of tenant ids. Entitlements are always computed.
 */
@Injectable()
export class EntitlementsService {
  private readonly logger = new Logger(EntitlementsService.name);
  private readonly cache = new Map<string, { at: number; value: Entitlements }>();

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  /** Env-based enforcement: SUBSCRIPTION_ENFORCEMENT = off (default) | all | comma-separated tenant ids. */
  isEnforcedByEnv(tenantId: string): boolean {
    const raw = (process.env.SUBSCRIPTION_ENFORCEMENT ?? 'off').trim();
    if (!raw || raw === 'off') return false;
    if (raw === 'all') return true;
    return raw.split(',').map((s) => s.trim()).includes(tenantId);
  }

  /** Per-tenant rollout switch stored in tenants.subscription_enforced (migration 317). Fails safe to false. */
  private async isEnforcedByDb(tenantId: string): Promise<boolean> {
    try {
      const { data } = await this.supabase
        .from('tenants')
        .select('subscription_enforced')
        .eq('id', tenantId)
        .maybeSingle<{ subscription_enforced: boolean }>();
      return data?.subscription_enforced === true;
    } catch {
      return false;
    }
  }

  async get(tenantId: string): Promise<Entitlements> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const value = await this.compute(tenantId);
    this.cache.set(tenantId, { at: Date.now(), value });
    return value;
  }

  /** Throws 402 SUBSCRIPTION_LOCKED when enforcement is on for the tenant (env or DB flag) and its plan ended. */
  async assertAccess(tenantId: string, path: string): Promise<void> {
    if (LOCK_EXEMPT.test(path)) return;
    const ent = await this.get(tenantId);
    if (!ent.enforced || !ent.locked) return;
    throw new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        code: 'SUBSCRIPTION_LOCKED',
        message: 'Your subscription has ended. Renew to continue.',
        ends_at: ent.ends_at,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }

  private async compute(tenantId: string): Promise<Entitlements> {
    const enforced = this.isEnforcedByEnv(tenantId) || (await this.isEnforcedByDb(tenantId));
    const base: Entitlements = {
      tenant_id: tenantId,
      enforced,
      phase: 'none',
      locked: true,
      days_left: null,
      show_countdown: false,
      ends_at: null,
      subscription_id: null,
      status: null,
      billing_cycle: null,
      plan: null,
      limits: { max_users: 0, max_branches: 0, max_pos: 0 },
      features: [],
    };
    try {
      const sub = await this.latestSubscription(tenantId);
      if (!sub) return base;

      const { data: plan } = await this.supabase
        .from('plans')
        .select('id, name, max_users, max_branches, max_pos')
        .eq('id', sub.plan_id)
        .maybeSingle<{
          id: string;
          name: string;
          max_users: number;
          max_branches: number;
          max_pos: number;
        }>();

      const end = this.endOf(sub);
      const now = Date.now();
      const ended = ['suspended', 'expired', 'cancelled'].includes(sub.status) ||
        (end !== null && end.getTime() <= now);
      const days =
        end === null ? null : ended ? 0 : Math.max(0, Math.ceil((end.getTime() - now) / DAY_MS));

      // The countdown is pure math on `end`, so it is always live without anyone being online. The moment it
      // reaches zero, the first computation that sees it flips the stored row to ended (fire-and-forget) — the
      // lock itself never waits for this. The hourly cron stays as a fallback: if this write is missed (nobody
      // ever touches a dead tenant), the cron still catches it, so the counter failing cannot leave a row stale.
      if (end !== null && end.getTime() <= now && ['trial', 'active', 'grace_period'].includes(sub.status)) {
        void this.persistEnded(sub.id, sub.status);
      }

      const phase: EntitlementPhase = ended
        ? 'locked'
        : sub.status === 'trial'
          ? 'trial'
          : sub.status === 'grace_period'
            ? 'grace'
            : 'active';

      const extras = await this.activeAddons(tenantId);
      const limit = (planMax: number, extra: number) => (planMax === -1 ? -1 : planMax + extra);

      return {
        ...base,
        phase,
        locked: ended,
        days_left: days,
        show_countdown: days !== null && days <= COUNTDOWN_DAYS,
        ends_at: end ? end.toISOString() : null,
        subscription_id: sub.id,
        status: sub.status,
        billing_cycle: sub.billing_cycle,
        plan: plan ? { id: plan.id, name: plan.name } : null,
        limits: {
          max_users: limit(plan?.max_users ?? 0, extras.users),
          max_branches: limit(plan?.max_branches ?? 0, extras.branches),
          max_pos: limit(plan?.max_pos ?? 0, extras.pos),
        },
        features: await this.featuresFor(tenantId, sub.plan_id, extras.features),
      };
    } catch (e) {
      // Fail OPEN for access (never lock a paying tenant because of a lookup error), but report loudly.
      this.logger.error(`entitlements lookup failed for ${tenantId}: ${e instanceof Error ? e.message : e}`);
      return { ...base, phase: 'active', locked: false };
    }
  }

  /**
   * Counter-driven state write: the instant the countdown hits zero, mark the row ended. Same mapping the
   * fallback cron uses (trial/grace → suspended, active → expired + locked_at). Fire-and-forget: a failure
   * here never affects the request, and the cron will still correct the row later.
   */
  private async persistEnded(subId: string, status: string): Promise<void> {
    const now = new Date().toISOString();
    const patch =
      status === 'active'
        ? { status: 'expired', locked_at: now, updated_at: now }
        : { status: 'suspended', suspended_at: now, updated_at: now };
    try {
      await this.supabase.from('subscriptions').update(patch).eq('id', subId).eq('status', status);
    } catch (e) {
      this.logger.warn(`persistEnded failed for ${subId}: ${e instanceof Error ? e.message : e}`);
    }
  }

  private endOf(sub: SubRow): Date | null {
    const raw =
      sub.status === 'trial'
        ? sub.trial_ends_at
        : sub.status === 'grace_period'
          ? (sub.grace_period_ends_at ?? sub.current_period_end)
          : (sub.current_period_end ?? sub.trial_ends_at);
    return raw ? new Date(raw) : null;
  }

  /** Latest meaningful subscription: a live one first, else the most recent ended one (so the popup can say when). */
  private async latestSubscription(tenantId: string): Promise<SubRow | null> {
    const { data, error } = await this.supabase
      .from('subscriptions')
      .select('id, plan_id, status, billing_cycle, trial_ends_at, current_period_end, grace_period_ends_at')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) throw error;
    const rows = (data ?? []) as SubRow[];
    return (
      rows.find((r) => ['trial', 'active', 'grace_period'].includes(r.status)) ??
      rows.find((r) => ['suspended', 'expired'].includes(r.status)) ??
      rows[0] ??
      null
    );
  }

  private async activeAddons(
    tenantId: string,
  ): Promise<{ users: number; branches: number; pos: number; features: string[] }> {
    const { data, error } = await this.supabase
      .from('subscription_addons')
      .select('quantity, status, ends_at, addons(type, feature_key)')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .in('status', ['purchased', 'installing', 'active']);
    // Migration 316 not applied yet: no add-ons, nothing else changes.
    if (error) return { users: 0, branches: 0, pos: 0, features: [] };
    let users = 0;
    let branches = 0;
    let pos = 0;
    const features: string[] = [];
    const now = Date.now();
    for (const r of (data ?? []) as unknown as {
      quantity: number;
      status: string;
      ends_at: string | null;
      addons: { type: string; feature_key: string | null } | { type: string; feature_key: string | null }[] | null;
    }[]) {
      if (r.ends_at && new Date(r.ends_at).getTime() <= now) continue;
      const a = Array.isArray(r.addons) ? r.addons[0] : r.addons;
      if (!a) continue;
      if (a.type === 'extra_user') users += r.quantity;
      else if (a.type === 'extra_branch') branches += r.quantity;
      else if (a.type === 'extra_pos') pos += r.quantity;
      else if (a.type === 'feature' && a.feature_key && r.status === 'active') features.push(a.feature_key);
    }
    return { users, branches, pos, features };
  }

  private async featuresFor(tenantId: string, planId: string, addonFeatures: string[]): Promise<string[]> {
    const { data: pf } = await this.supabase
      .from('plan_features')
      .select('feature_key')
      .eq('plan_id', planId)
      .eq('is_enabled', true);
    const set = new Set<string>([
      ...((pf ?? []) as { feature_key: string }[]).map((r) => r.feature_key),
      ...addonFeatures,
    ]);
    const { data: ov } = await this.supabase
      .from('tenant_feature_overrides')
      .select('feature_key, is_enabled')
      .eq('tenant_id', tenantId);
    for (const o of (ov ?? []) as { feature_key: string; is_enabled: boolean | null }[]) {
      if (o.is_enabled === true) set.add(o.feature_key);
      else if (o.is_enabled === false) set.delete(o.feature_key);
    }
    return [...set];
  }
}
