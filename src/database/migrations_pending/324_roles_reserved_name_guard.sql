-- 324 — R-01 / WP-A: database-level separation of platform identity from tenant roles.
--
-- STATUS: PENDING — authored in migrations_pending/ on purpose. migrate.ts only scans
-- src/database/migrations, so a deploy can NOT apply this file. It is moved to
-- migrations/ only inside an owner-approved production window (stop point SP-5).
-- Applied so far to the LOCAL disposable test database only.
--
-- Root cause being closed: privilege was derived from role NAMES that a tenant could
-- choose (a tenant owner could create a role called "superadmin" / "owner" / "manager",
-- assign it, and the JWT / by-name permission lookups treated it as the real thing).
-- The application now decides privilege from identity (tenant-less user + GLOBAL role),
-- and this migration makes the database refuse the same shapes for any writer
-- (API, scripts, direct SQL by a service_role session, future code paths).
--
-- Design notes
--  * Triggers, not CHECK constraints: existing offending rows (if any) must not block
--    this migration or ordinary updates of those rows. Only NEW offending writes are
--    rejected. Existing rows are listed by v_role_identity_violations for a reviewed,
--    separately-approved clean-up (never performed by this file).
--  * fn_normalize_role_name() mirrors normalizeRoleName() in
--    src/core/security/platform-identity.ts (NFKC, strip combining marks, strip
--    zero-width/format characters, whitespace and the separators _ - ., lower-case,
--    fold common Cyrillic/Greek look-alikes). It is deliberately not a complete
--    confusables table (documented residual risk).
--  * Additive only: no existing table/column/function is altered or dropped.

-- ---------------------------------------------------------------------------
-- 1. Name normalisation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_normalize_role_name(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT translate(
    lower(
      regexp_replace(
        regexp_replace(
          normalize(normalize(coalesce(p_name, ''), NFKC), NFKD),
          '[̀-ͯ]', '', 'g'),
        '[\s_\-.­​-‏‪-‮⁠-⁤﻿]', '', 'g')
    ),
    'аеорсхуіјѕԁԛѡνοριαετυκηɡıӏⅼｌ',
    'aeopcxyijsdqwvopiaetukngilll'
  )
$$;

-- ---------------------------------------------------------------------------
-- 2. Reserved-name test: static list (fail-closed) + every GLOBAL role name
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_is_reserved_role_name(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    fn_normalize_role_name(p_name) = ANY (ARRAY[
      'superadmin','owner','manager','cashier','worker','inventoryclerk','none',
      'admin','administrator','platform','root','system','sefay','support'
    ])
    OR EXISTS (
      SELECT 1 FROM roles r
      WHERE r.tenant_id IS NULL
        AND fn_normalize_role_name(r.name) = fn_normalize_role_name(p_name)
    )
$$;

-- ---------------------------------------------------------------------------
-- 3. roles: a tenant-scoped role may not take a reserved / system name
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_guard_role_reserved_name() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN
    IF TG_OP = 'INSERT'
       OR NEW.name IS DISTINCT FROM OLD.name
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      IF fn_normalize_role_name(NEW.name) = '' THEN
        RAISE EXCEPTION 'Role name "%" is not valid', NEW.name USING ERRCODE = '23514';
      END IF;
      IF fn_is_reserved_role_name(NEW.name) THEN
        RAISE EXCEPTION 'Role name "%" is reserved for system roles and cannot be used by a tenant role', NEW.name
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_roles_reserved_name_guard ON roles;
CREATE TRIGGER trg_roles_reserved_name_guard
BEFORE INSERT OR UPDATE OF name, tenant_id ON roles
FOR EACH ROW EXECUTE FUNCTION fn_guard_role_reserved_name();

-- ---------------------------------------------------------------------------
-- 4. user_roles: identity / tenant consistency
--     * the GLOBAL platform role can only be held by a tenant-less user
--     * a tenant-scoped role can only be held by a user of that same tenant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_guard_user_role_identity() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_user_tenant UUID;
  v_role_tenant UUID;
  v_role_name   TEXT;
BEGIN
  SELECT tenant_id INTO v_user_tenant FROM users WHERE id = NEW.user_id;
  SELECT tenant_id, name INTO v_role_tenant, v_role_name FROM roles WHERE id = NEW.role_id;

  IF v_role_tenant IS NULL AND v_role_name = 'superadmin' AND v_user_tenant IS NOT NULL THEN
    RAISE EXCEPTION 'The platform role cannot be assigned to a tenant user (user %)', NEW.user_id
      USING ERRCODE = '23514';
  END IF;

  IF v_role_tenant IS NOT NULL AND v_user_tenant IS DISTINCT FROM v_role_tenant THEN
    RAISE EXCEPTION 'Role % belongs to another tenant (or the user has no tenant) and cannot be assigned to user %', NEW.role_id, NEW.user_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_roles_identity_guard ON user_roles;
CREATE TRIGGER trg_user_roles_identity_guard
BEFORE INSERT OR UPDATE OF user_id, role_id ON user_roles
FOR EACH ROW EXECUTE FUNCTION fn_guard_user_role_identity();

-- ---------------------------------------------------------------------------
-- 5. users: the legacy role mirror and the tenant link may not be used to become
--    a platform user. Only NEW values are checked (existing rows are untouched).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_guard_user_platform_identity() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'superadmin' AND NEW.tenant_id IS NOT NULL THEN
    IF TG_OP = 'INSERT'
       OR OLD.role IS DISTINCT FROM NEW.role
       OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'A tenant user cannot hold the superadmin role (user %)', NEW.id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION 'A tenant user cannot be converted into a tenant-less (platform) user (user %)', NEW.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_platform_identity_guard ON users;
CREATE TRIGGER trg_users_platform_identity_guard
BEFORE INSERT OR UPDATE OF role, tenant_id ON users
FOR EACH ROW EXECUTE FUNCTION fn_guard_user_platform_identity();

-- ---------------------------------------------------------------------------
-- 6. Read-only audit view of EXISTING violations (for the owner/DBA review that
--    must precede any clean-up). Returns identifiers and names only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_role_identity_violations AS
  SELECT 'tenant_role_reserved_name'::text AS violation,
         r.tenant_id, r.id AS role_id, NULL::uuid AS user_id, r.name AS role_name
  FROM roles r
  WHERE r.tenant_id IS NOT NULL AND fn_is_reserved_role_name(r.name)
  UNION ALL
  SELECT 'platform_role_on_tenant_user', u.tenant_id, r.id, u.id, r.name
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  JOIN users u ON u.id = ur.user_id
  WHERE r.tenant_id IS NULL AND r.name = 'superadmin' AND u.tenant_id IS NOT NULL
  UNION ALL
  SELECT 'user_role_tenant_mismatch', r.tenant_id, r.id, u.id, r.name
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  JOIN users u ON u.id = ur.user_id
  WHERE r.tenant_id IS NOT NULL AND u.tenant_id IS DISTINCT FROM r.tenant_id
  UNION ALL
  SELECT 'user_superadmin_with_tenant', u.tenant_id, NULL::uuid, u.id, u.role
  FROM users u
  WHERE u.role = 'superadmin' AND u.tenant_id IS NOT NULL;

-- Supabase default privileges grant new objects to anon/authenticated: lock these down.
REVOKE ALL ON v_role_identity_violations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON v_role_identity_violations TO service_role;
REVOKE ALL ON FUNCTION fn_normalize_role_name(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fn_is_reserved_role_name(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_normalize_role_name(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION fn_is_reserved_role_name(TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- ROLLBACK (documented AND exercised locally: apply -> rollback -> re-apply). No data
-- is changed by this migration, so rolling back loses nothing:
--   DROP VIEW IF EXISTS v_role_identity_violations;
--   DROP TRIGGER IF EXISTS trg_users_platform_identity_guard ON users;
--   DROP FUNCTION IF EXISTS fn_guard_user_platform_identity();
--   DROP TRIGGER IF EXISTS trg_user_roles_identity_guard ON user_roles;
--   DROP FUNCTION IF EXISTS fn_guard_user_role_identity();
--   DROP TRIGGER IF EXISTS trg_roles_reserved_name_guard ON roles;
--   DROP FUNCTION IF EXISTS fn_guard_role_reserved_name();
--   DROP FUNCTION IF EXISTS fn_is_reserved_role_name(TEXT);
--   DROP FUNCTION IF EXISTS fn_normalize_role_name(TEXT);
-- ---------------------------------------------------------------------------
