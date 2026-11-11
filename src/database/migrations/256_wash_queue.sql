-- 256. Car-wash queue (gap G5 of APP_ARCHITECTURE_REVIEW, owner approved
-- 2026-11-09): a board of cars waiting / being washed / ready / delivered.
--
--   wash_jobs        one row per car in the queue. A job may stand alone
--                    (plate only) or be linked to an order and a customer.
--   wash_job_events  append-only history of every status change / worker
--                    assignment (from, to, by, at).
--
-- State machine (enforced HERE, in fn_wash_job_transition, so no client or
-- service can skip it):
--   waiting -> washing -> ready -> delivered
--   waiting | washing   -> cancelled
--   ready   -> washing  (re-wash; only when p_allow_rewash = true, i.e. the
--                        caller already checked the actor is authorised)
-- delivered and cancelled are terminal.
--
-- queue_number restarts at 1 for each branch every day (queue_date, UTC
-- calendar day of creation) and is allocated under an advisory lock so two
-- simultaneous check-ins never get the same number.
--
-- Car-ready notification (G9): ready_notified_at is set by the application's
-- CarReadyNotifier once a notification channel actually delivered; the DB
-- only stores it.
--
-- New-table checklist: tenant_id, deleted_at, RLS policy, service_role GRANT.

CREATE TABLE IF NOT EXISTS wash_jobs (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id          UUID        NOT NULL REFERENCES branches(id),
  order_id           UUID        REFERENCES orders(id),
  customer_id        UUID        REFERENCES customers(id),
  plate              TEXT        NOT NULL CHECK (length(btrim(plate)) > 0),
  vehicle_size       TEXT,
  status             TEXT        NOT NULL DEFAULT 'waiting'
                       CHECK (status IN ('waiting','washing','ready','delivered','cancelled')),
  assigned_worker_id UUID        REFERENCES users(id),
  queue_date         DATE        NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC')::date),
  queue_number       INTEGER     NOT NULL CHECK (queue_number > 0),
  notes              TEXT,
  created_by         UUID        REFERENCES users(id),
  washing_at         TIMESTAMPTZ,
  ready_at           TIMESTAMPTZ,
  delivered_at       TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ,
  ready_notified_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS wash_job_events (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id         UUID        NOT NULL REFERENCES wash_jobs(id) ON DELETE CASCADE,
  event_type     TEXT        NOT NULL CHECK (event_type IN ('created','status_changed','worker_assigned')),
  from_status    TEXT,
  to_status      TEXT,
  from_worker_id UUID,
  to_worker_id   UUID,
  actor_id       UUID        REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wash_jobs_queue_number
  ON wash_jobs (tenant_id, branch_id, queue_date, queue_number);
CREATE INDEX IF NOT EXISTS idx_wash_jobs_board
  ON wash_jobs (tenant_id, branch_id, queue_date, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wash_jobs_order
  ON wash_jobs (tenant_id, order_id) WHERE order_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wash_job_events_job
  ON wash_job_events (tenant_id, job_id, created_at);

ALTER TABLE wash_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON wash_jobs
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE wash_job_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON wash_job_events
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT ALL PRIVILEGES ON public.wash_jobs       TO service_role;
GRANT ALL PRIVILEGES ON public.wash_job_events TO service_role;

-- ---------------------------------------------------------------------
-- Create a job: validates branch / order / customer / worker belong to the
-- tenant, allocates the per-branch-per-day number, writes the 'created' event.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_create_wash_job(
  p_tenant_id    uuid,
  p_branch_id    uuid,
  p_actor_id     uuid,
  p_plate        text,
  p_vehicle_size text,
  p_order_id     uuid,
  p_customer_id  uuid,
  p_worker_id    uuid,
  p_notes        text
) RETURNS wash_jobs
LANGUAGE plpgsql
AS $function$
DECLARE
  v_date   date := (now() AT TIME ZONE 'UTC')::date;
  v_number integer;
  v_job    wash_jobs;
  v_order  RECORD;
BEGIN
  IF p_plate IS NULL OR length(btrim(p_plate)) = 0 THEN
    RAISE EXCEPTION 'WASH_PLATE_REQUIRED: plate is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = p_branch_id AND tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'WASH_BRANCH_NOT_FOUND: branch not found';
  END IF;
  IF p_order_id IS NOT NULL THEN
    SELECT id, customer_id INTO v_order
      FROM orders WHERE id = p_order_id AND tenant_id = p_tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'WASH_ORDER_NOT_FOUND: order not found';
    END IF;
    IF p_customer_id IS NULL THEN p_customer_id := v_order.customer_id; END IF;
  END IF;
  IF p_customer_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM customers WHERE id = p_customer_id AND tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'WASH_CUSTOMER_NOT_FOUND: customer not found';
  END IF;
  IF p_worker_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM users WHERE id = p_worker_id AND tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'WASH_WORKER_NOT_FOUND: worker not found';
  END IF;

  -- serialise number allocation per tenant+branch+day
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || p_branch_id::text || v_date::text, 0));
  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_number
    FROM wash_jobs
   WHERE tenant_id = p_tenant_id AND branch_id = p_branch_id AND queue_date = v_date;

  INSERT INTO wash_jobs (tenant_id, branch_id, order_id, customer_id, plate, vehicle_size,
                         assigned_worker_id, queue_date, queue_number, notes, created_by)
  VALUES (p_tenant_id, p_branch_id, p_order_id, p_customer_id, btrim(p_plate), p_vehicle_size,
          p_worker_id, v_date, v_number, p_notes, p_actor_id)
  RETURNING * INTO v_job;

  INSERT INTO wash_job_events (tenant_id, job_id, event_type, to_status, to_worker_id, actor_id)
  VALUES (p_tenant_id, v_job.id, 'created', 'waiting', p_worker_id, p_actor_id);

  RETURN v_job;
END;
$function$;

-- ---------------------------------------------------------------------
-- Status change with the state machine. The row is locked so two
-- simultaneous changes cannot both pass the check.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_wash_job_transition(
  p_tenant_id     uuid,
  p_job_id        uuid,
  p_to            text,
  p_actor_id      uuid,
  p_allow_rewash  boolean DEFAULT false
) RETURNS wash_jobs
LANGUAGE plpgsql
AS $function$
DECLARE
  v_job  wash_jobs;
  v_from text;
  v_ok   boolean;
BEGIN
  SELECT * INTO v_job FROM wash_jobs
   WHERE id = p_job_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WASH_JOB_NOT_FOUND: wash job not found';
  END IF;
  v_from := v_job.status;

  v_ok := (v_from = 'waiting' AND p_to IN ('washing','cancelled'))
       OR (v_from = 'washing' AND p_to IN ('ready','cancelled'))
       OR (v_from = 'ready'   AND p_to = 'delivered')
       OR (v_from = 'ready'   AND p_to = 'washing' AND p_allow_rewash);

  IF NOT v_ok THEN
    IF v_from = 'ready' AND p_to = 'washing' THEN
      RAISE EXCEPTION 'WASH_REWASH_NOT_ALLOWED: only an authorised role may send a ready car back to washing';
    END IF;
    RAISE EXCEPTION 'WASH_INVALID_TRANSITION: cannot change a % job to %', v_from, p_to;
  END IF;

  UPDATE wash_jobs SET
    status       = p_to,
    washing_at   = CASE WHEN p_to = 'washing' AND washing_at IS NULL THEN now() ELSE washing_at END,
    ready_at     = CASE WHEN p_to = 'ready' THEN now() WHEN p_to = 'washing' THEN NULL ELSE ready_at END,
    delivered_at = CASE WHEN p_to = 'delivered' THEN now() ELSE delivered_at END,
    cancelled_at = CASE WHEN p_to = 'cancelled' THEN now() ELSE cancelled_at END,
    -- a re-wash must be able to notify again when it is ready the second time
    ready_notified_at = CASE WHEN p_to = 'washing' THEN NULL ELSE ready_notified_at END,
    updated_at   = now()
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  INSERT INTO wash_job_events (tenant_id, job_id, event_type, from_status, to_status, actor_id)
  VALUES (p_tenant_id, p_job_id, 'status_changed', v_from, p_to, p_actor_id);

  RETURN v_job;
END;
$function$;

-- ---------------------------------------------------------------------
-- Assign / reassign / unassign (p_worker_id NULL). Not allowed on a
-- delivered or cancelled job.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_wash_job_assign(
  p_tenant_id uuid,
  p_job_id    uuid,
  p_worker_id uuid,
  p_actor_id  uuid
) RETURNS wash_jobs
LANGUAGE plpgsql
AS $function$
DECLARE
  v_job wash_jobs;
  v_old uuid;
BEGIN
  SELECT * INTO v_job FROM wash_jobs
   WHERE id = p_job_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WASH_JOB_NOT_FOUND: wash job not found';
  END IF;
  IF v_job.status IN ('delivered','cancelled') THEN
    RAISE EXCEPTION 'WASH_INVALID_TRANSITION: cannot assign a worker to a % job', v_job.status;
  END IF;
  IF p_worker_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM users WHERE id = p_worker_id AND tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'WASH_WORKER_NOT_FOUND: worker not found';
  END IF;

  v_old := v_job.assigned_worker_id;
  UPDATE wash_jobs SET assigned_worker_id = p_worker_id, updated_at = now()
   WHERE id = p_job_id RETURNING * INTO v_job;

  INSERT INTO wash_job_events (tenant_id, job_id, event_type, from_worker_id, to_worker_id, actor_id)
  VALUES (p_tenant_id, p_job_id, 'worker_assigned', v_old, p_worker_id, p_actor_id);

  RETURN v_job;
END;
$function$;

GRANT EXECUTE ON FUNCTION fn_create_wash_job(uuid, uuid, uuid, text, text, uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION fn_wash_job_transition(uuid, uuid, text, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION fn_wash_job_assign(uuid, uuid, uuid, uuid) TO service_role;

-- Live board: the web app subscribes to Postgres Changes on wash_jobs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                      WHERE pubname = 'supabase_realtime' AND tablename = 'wash_jobs') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE wash_jobs;
  END IF;
END $$;
