/**
 * Platform vs tenant identity (R-01 / WP-A).
 *
 * Root cause being closed: guards used to grant platform (superadmin) and
 * owner privileges from a role NAME found in the JWT `roles[]`, and a tenant
 * owner could create and assign a tenant-scoped role with any name. Privilege
 * must come from a trusted identity, never from a string a tenant chose:
 *
 *   Platform Super Admin = a user with NO tenant (users.tenant_id IS NULL)
 *                          that holds the GLOBAL role `superadmin`
 *                          (roles.tenant_id IS NULL).
 *   Tenant Owner         = a tenant user that holds the GLOBAL role `owner`.
 *
 * `buildRoleClaims` is the only place that turns user_roles rows into token
 * claims; `isPlatformAdmin` is the only place guards decide "platform".
 */

/** Names of the global (system) roles — seeded in migration 059, hierarchy in 189. */
export const SYSTEM_ROLE_NAMES = [
  'superadmin',
  'owner',
  'manager',
  'cashier',
  'worker',
  'inventory_clerk',
  'none',
] as const;

/**
 * Names a tenant may never use for a tenant-scoped role. Superset of the
 * system roles: generic privileged words are reserved too so a look-alike
 * can never be mistaken for a privileged identity in logs, UI or by-name
 * lookups. The database trigger (migration 324) applies the same list.
 */
export const RESERVED_ROLE_NAMES: readonly string[] = [
  ...SYSTEM_ROLE_NAMES,
  'admin',
  'administrator',
  'platform',
  'root',
  'system',
  'sefay',
  'support',
];

/** Roles that can never be granted to a tenant user through any tenant-facing path. */
export const PLATFORM_ONLY_ROLE_NAMES: readonly string[] = ['superadmin'];

// Common Cyrillic / Greek / full-width look-alikes folded to Latin. Not a
// complete confusables table (documented residual risk): the list is the
// same one the SQL function fn_normalize_role_name() uses (migration 324).
const CONFUSABLES: Record<string, string> = {
  а: 'a', // Cyrillic a
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  х: 'x',
  у: 'y',
  і: 'i',
  ј: 'j',
  ѕ: 's',
  ԁ: 'd',
  ԛ: 'q',
  ѡ: 'w',
  ν: 'v', // Greek nu
  ο: 'o', // Greek omicron
  ρ: 'p',
  ι: 'i',
  α: 'a',
  ε: 'e',
  τ: 't',
  υ: 'u',
  κ: 'k',
  η: 'n',
  ɡ: 'g',
  ı: 'i',
  ӏ: 'l', // Cyrillic palochka
  ⅼ: 'l',
  ｌ: 'l',
};

/**
 * Canonical comparison form: NFKC (folds full-width / compatibility forms),
 * strip combining marks, strip zero-width / format characters, whitespace and
 * the separators `_ - .`, lower-case, then fold known look-alikes.
 */
export function normalizeRoleName(name: string): string {
  if (typeof name !== 'string') return '';
  let s = name.normalize('NFKC');
  s = s.normalize('NFKD').replace(/\p{M}+/gu, '');
  s = s.replace(/[\p{Cf}\s_\-.]+/gu, '');
  s = s.toLowerCase();
  let out = '';
  for (const ch of s) out += CONFUSABLES[ch] ?? ch;
  return out;
}

const RESERVED_NORMALIZED = new Set(RESERVED_ROLE_NAMES.map(normalizeRoleName));

/**
 * True when `name` (after normalisation) equals a reserved name. `extra` lets
 * callers add the live list of global role names read from the database so a
 * role added later is protected without a code change; the static list is the
 * fail-closed fallback.
 */
export function isReservedRoleName(
  name: string,
  extra: Iterable<string> = [],
): boolean {
  const n = normalizeRoleName(name);
  if (!n) return false;
  if (RESERVED_NORMALIZED.has(n)) return true;
  for (const e of extra) if (normalizeRoleName(e) === n) return true;
  return false;
}

export interface UserRoleRow {
  name: string;
  /** NULL = global (system) role, otherwise the owning tenant. */
  tenant_id: string | null;
}

export interface RoleClaimUser {
  /** users.role (legacy enum mirror). */
  role: string;
  tenant_id: string | null;
}

export interface RoleClaims {
  roles: string[];
  platform_admin: boolean;
}

/**
 * Turn a user's user_roles rows into JWT claims.
 *  - Names of GLOBAL roles are passed through.
 *  - Names of TENANT-scoped roles are passed through unless they are reserved
 *    (a pre-existing look-alike such as a tenant role called `superadmin` or
 *    `owner` then grants nothing).
 *  - `platform_admin` is true only for a tenant-less user that holds the
 *    global `superadmin` role (or carries it as the legacy users.role mirror).
 */
export function buildRoleClaims(
  rows: UserRoleRow[],
  user: RoleClaimUser,
): RoleClaims {
  const roles: string[] = [];
  let holdsGlobalSuperadmin = false;
  for (const row of rows) {
    if (!row || !row.name) continue;
    if (row.tenant_id === null) {
      roles.push(row.name);
      if (row.name === 'superadmin') holdsGlobalSuperadmin = true;
    } else if (!isReservedRoleName(row.name)) {
      roles.push(row.name);
    }
  }
  const tenantless = user.tenant_id === null || user.tenant_id === undefined;
  const platform_admin =
    tenantless && (holdsGlobalSuperadmin || user.role === 'superadmin');

  // Never let a tenant user's token carry the platform role name, whatever
  // the database says (defence in depth: the guards ignore it anyway).
  const safeRoles = tenantless
    ? roles
    : roles.filter((r) => r !== 'superadmin');
  const legacyRole =
    !tenantless && user.role === 'superadmin' ? 'none' : user.role;
  return {
    roles: safeRoles.length > 0 ? safeRoles : [legacyRole],
    platform_admin,
  };
}

export interface RoleIdRow {
  id: string;
  name: string;
  /** NULL = global (system) role, otherwise the owning tenant. */
  tenant_id: string | null;
}

/**
 * Role ids (not names) that really apply to a user inside `tenantId`, from the
 * user's user_roles rows joined to roles (R-DOC-01).
 *  - GLOBAL roles count.
 *  - TENANT roles count only when owned by THIS tenant and not reserved (a
 *    look-alike of a system/platform name grants nothing, same rule as
 *    buildRoleClaims()).
 *  - Roles of any other tenant never count.
 */
export function selectEffectiveRoleIds(
  rows: RoleIdRow[],
  tenantId: string,
): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (!r || !r.id || !r.name) continue;
    if (r.tenant_id === null || r.tenant_id === undefined) out.push(r.id);
    else if (r.tenant_id === tenantId && !isReservedRoleName(r.name))
      out.push(r.id);
  }
  return out;
}

interface IdentityLike {
  platform_admin?: boolean;
  role?: string;
  roles?: string[];
  tenant_id?: string | null;
}

function roleNamesOf(user: IdentityLike): string[] {
  return Array.isArray(user.roles) ? user.roles : user.role ? [user.role] : [];
}

/**
 * The single decision "is this caller a platform administrator?".
 *  - New tokens carry `platform_admin`; it is honoured only for tenant-less
 *    identities.
 *  - Tokens issued before this change (no claim) are honoured transitionally,
 *    but ONLY when the token has no tenant — a tenant user's token naming
 *    `superadmin` is never platform, whatever role the tenant created.
 */
export function isPlatformAdmin(
  user: IdentityLike | null | undefined,
): boolean {
  if (!user) return false;
  const tenantless = user.tenant_id === null || user.tenant_id === undefined;
  if (!tenantless) return false;
  if (user.platform_admin === true) return true;
  if (user.platform_admin === false) return false;
  return roleNamesOf(user).includes('superadmin');
}

/**
 * Tenant owner: the caller's (already sanitised, see buildRoleClaims) roles
 * include `owner`. No tenant check here on purpose: every owner-level route
 * also passes TenantGuard, which rejects a tenant-less non-platform token.
 */
export function isTenantOwner(user: IdentityLike | null | undefined): boolean {
  if (!user) return false;
  return roleNamesOf(user).includes('owner');
}

/** Owner of the tenant or a platform administrator (the "central admin" check). */
export function isOwnerOrPlatformAdmin(
  user: IdentityLike | null | undefined,
): boolean {
  return isPlatformAdmin(user) || isTenantOwner(user);
}
