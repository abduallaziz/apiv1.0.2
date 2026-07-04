-- Migration 044 (HR core) created attendance_records and work_schedules without granting
-- service_role privileges, following the pattern in migration 029 — this went unnoticed
-- until production started returning "permission denied for table work_schedules" (42501).
-- Granting here for those two, plus the two new tables from migration 046.

GRANT ALL ON public.attendance_records TO service_role;
GRANT ALL ON public.work_schedules TO service_role;
GRANT ALL ON public.employee_geofences TO service_role;
GRANT ALL ON public.attendance_exceptions TO service_role;
