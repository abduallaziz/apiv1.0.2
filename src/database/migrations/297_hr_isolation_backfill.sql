-- 297_hr_isolation_backfill.sql  (TASK 4 - D7)
-- Called by BranchesService.setIsolation(true) BEFORE the generic fn_branch_isolation_backfill.
--  1. every non-central user without a branch joins the MAIN branch (owner/superadmin stay central = NULL);
--  2. per-employee rows (attendance, schedules, geofences, exceptions) follow the employee's branch;
--     whatever is still NULL afterwards is picked up by the generic registry backfill (main branch).
-- Idempotent. ROLLBACK: DROP FUNCTION IF EXISTS fn_branch_isolation_backfill_hr(uuid);

CREATE OR REPLACE FUNCTION fn_branch_isolation_backfill_hr(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $$
DECLARE
  v_main uuid;
  v_n bigint;
  v_result jsonb := '{}'::jsonb;
BEGIN
  SELECT id INTO v_main FROM branches
   WHERE tenant_id = p_tenant_id AND is_main AND deleted_at IS NULL LIMIT 1;
  IF v_main IS NULL THEN
    RAISE EXCEPTION 'tenant % has no main branch', p_tenant_id;
  END IF;

  UPDATE users SET branch_id = v_main
   WHERE tenant_id = p_tenant_id AND branch_id IS NULL AND deleted_at IS NULL
     AND role NOT IN ('owner', 'superadmin');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_result := v_result || jsonb_build_object('users', v_n); END IF;

  UPDATE attendance_records r SET branch_id = u.branch_id
    FROM users u WHERE r.user_id = u.id AND r.tenant_id = p_tenant_id
     AND r.branch_id IS NULL AND u.branch_id IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_result := v_result || jsonb_build_object('attendance_records', v_n); END IF;

  UPDATE work_schedules s SET branch_id = u.branch_id
    FROM users u WHERE s.user_id = u.id AND s.tenant_id = p_tenant_id
     AND s.branch_id IS NULL AND u.branch_id IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_result := v_result || jsonb_build_object('work_schedules', v_n); END IF;

  UPDATE employee_geofences g SET branch_id = u.branch_id
    FROM users u WHERE g.user_id = u.id AND g.tenant_id = p_tenant_id
     AND g.branch_id IS NULL AND u.branch_id IS NOT NULL;
  UPDATE attendance_exceptions e SET branch_id = u.branch_id
    FROM users u WHERE e.user_id = u.id AND e.tenant_id = p_tenant_id
     AND e.branch_id IS NULL AND u.branch_id IS NOT NULL;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION fn_branch_isolation_backfill_hr(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_branch_isolation_backfill_hr(uuid) TO service_role;
