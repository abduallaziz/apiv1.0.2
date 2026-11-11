/**
 * Regression suite for the audit branch-context matrix (Branch System
 * Step 5/6, Owner-approved): confirms AuditService.log() writes the correct
 * branch_id in every category of caller — direct resource-branch columns,
 * warehouse_id -> warehouses.branch_id resolution (the
 * resolveBranchForWarehouse pattern copy-pasted per-service), genuinely
 * tenant-wide events (always null), the AuditInterceptor's generic
 * always-null path for whatever remains on @Audit(), and the previously
 * missing audit events added alongside this work.
 *
 * Unlike most regression specs in this directory, this suite is pure
 * service-level unit tests against plain object stubs (no live Supabase
 * connection, no Nest DI bootstrap) — the thing under test is branch_id
 * resolution logic, not database round-trips, so stubbing every repo/
 * service call site keeps the suite fast and deterministic.
 */
import { Reflector } from '@nestjs/core';
import { AuditService } from '../../../core/audit/audit.service';
import { AuditInterceptor } from '../../../core/audit/audit.interceptor';
import { WorkCentersService } from '../../../modules/manufacturing/work-centers.service';
import { DevicesService } from '../../../modules/scanner/devices.service';
import { EventsService } from '../../../modules/scanner/events.service';
import { HoldsService } from '../../../modules/quality/holds.service';
import { CorrectiveActionsService } from '../../../modules/quality/corrective-actions.service';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const ACTOR = 'actor-1';

// A tiny stand-in for the Supabase client AuditService talks to: captures
// every insert() payload into `rows` instead of hitting a real database.
function makeFakeSupabase() {
  const rows: Record<string, unknown>[] = [];
  return {
    rows,
    client: {
      from: (table: string) => ({
        insert: (payload: Record<string, unknown>) => {
          if (table === 'audit_logs') rows.push(payload);
          return Promise.resolve({ error: null });
        },
      }),
    },
  };
}

describe('Audit branch-context matrix', () => {
  describe('1. Resource with a direct branch reference', () => {
    it('records the exact branch_id passed by the caller', async () => {
      const { rows, client } = makeFakeSupabase();
      const auditService = new AuditService(client as any);

      await auditService.log({
        tenant_id: TENANT_A,
        actor_id: ACTOR,
        action: 'warehouse.updated',
        resource_type: 'warehouse',
        resource_id: 'wh-1',
        branch_id: 'branch-direct-1',
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].branch_id).toBe('branch-direct-1');
    });
  });

  describe('2. Genuinely tenant-wide event', () => {
    it('records branch_id NULL', async () => {
      const { rows, client } = makeFakeSupabase();
      const auditService = new AuditService(client as any);

      await auditService.log({
        tenant_id: TENANT_A,
        actor_id: ACTOR,
        action: 'user.role.added',
        resource_type: 'user',
        resource_id: 'user-1',
        branch_id: null,
      });

      expect(rows[0].branch_id).toBeNull();
    });
  });

  describe('3. User branch reassignment A -> B', () => {
    it('the reassignment audit record carries branch B', async () => {
      const { rows, client } = makeFakeSupabase();
      const auditService = new AuditService(client as any);

      const BRANCH_A = 'branch-a';
      const BRANCH_B = 'branch-b';

      await auditService.log({
        tenant_id: TENANT_A,
        actor_id: ACTOR,
        action: 'employee.branch_reassigned',
        resource_type: 'employee',
        resource_id: 'emp-1',
        before_data: { branch_id: BRANCH_A },
        after_data: { branch_id: BRANCH_B },
        branch_id: BRANCH_B,
      });

      expect(rows[0].branch_id).toBe(BRANCH_B);
    });
  });

  describe('4. User reassignment B -> Central/null', () => {
    it('the reassignment audit record carries NULL', async () => {
      const { rows, client } = makeFakeSupabase();
      const auditService = new AuditService(client as any);

      await auditService.log({
        tenant_id: TENANT_A,
        actor_id: ACTOR,
        action: 'employee.branch_reassigned',
        resource_type: 'employee',
        resource_id: 'emp-1',
        before_data: { branch_id: 'branch-b' },
        after_data: { branch_id: null },
        branch_id: null,
      });

      expect(rows[0].branch_id).toBeNull();
    });
  });

  describe('5. Resource resolved via warehouse_id', () => {
    it('resolves to warehouse.branch_id', async () => {
      const { rows, client } = makeFakeSupabase();
      const auditService = new AuditService(client as any);
      const workCentersRepo = {
        create: async (_tenantId: string, payload: Record<string, unknown>) => ({
          id: 'wc-1',
          ...payload,
        }),
      };
      const warehousesService = {
        findById: async (id: string) => ({ id, branch_id: 'branch-wh-1' }),
      };
      const service = new WorkCentersService(
        workCentersRepo as any,
        warehousesService as any,
        auditService,
      );

      await service.create(
        TENANT_A,
        { name: 'WC1', warehouse_id: 'wh-1', is_active: true } as any,
        ACTOR,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe('work_center.created');
      expect(rows[0].branch_id).toBe('branch-wh-1');
    });
  });

  describe('6. Scanner device with assigned_warehouse_id', () => {
    it('resolves branch_id from the assigned warehouse', async () => {
      const { rows, client } = makeFakeSupabase();
      const auditService = new AuditService(client as any);
      const devicesRepo = {
        create: async (_tenantId: string, payload: Record<string, unknown>) => ({
          id: 'dev-1',
          ...payload,
        }),
        findById: async (id: string) => ({
          id,
          assigned_warehouse_id: 'wh-1',
        }),
      };
      const warehousesService = {
        findById: async (id: string) => ({ id, branch_id: 'branch-dev-1' }),
      };
      const service = new DevicesService(
        devicesRepo as any,
        warehousesService as any,
        auditService,
      );

      await service.create(
        TENANT_A,
        {
          device_code: 'DEV-1',
          name: 'Scanner 1',
          device_type: 'usb_hid',
          assigned_warehouse_id: 'wh-1',
        } as any,
        ACTOR,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].branch_id).toBe('branch-dev-1');
    });
  });

  describe('7. Scanner device unassigned', () => {
    it('records branch_id NULL, never throws', async () => {
      const { rows, client } = makeFakeSupabase();
      const auditService = new AuditService(client as any);
      const devicesRepo = {
        create: async (_tenantId: string, payload: Record<string, unknown>) => ({
          id: 'dev-2',
          ...payload,
        }),
        findById: async (id: string) => ({
          id,
          assigned_warehouse_id: null,
        }),
      };
      const warehousesService = {
        findById: async () => {
          throw new Error('should never be called for a null warehouse id');
        },
      };
      const service = new DevicesService(
        devicesRepo as any,
        warehousesService as any,
        auditService,
      );

      await service.create(
        TENANT_A,
        {
          device_code: 'DEV-2',
          name: 'Scanner 2',
          device_type: 'usb_hid',
          assigned_warehouse_id: null,
        } as any,
        ACTOR,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].branch_id).toBeNull();
    });
  });

  describe('8. Scanner event via assigned device', () => {
    it('resolves branch_id from the device on the duplicate-detected audit path', async () => {
      const { rows, client } = makeFakeSupabase();
      const auditService = new AuditService(client as any);

      const device = {
        id: 'dev-3',
        status: 'active',
        assigned_warehouse_id: 'wh-1',
      };
      const duplicateEvent = { id: 'evt-1' };

      const eventsRepo = {
        findByClientEventId: async () => duplicateEvent,
        findRecentDuplicate: async () => duplicateEvent,
      };
      const sessionsRepo = {};
      const devicesRepo = { findById: async () => device };
      const devicesService = {};
      const auditRepo = { create: async () => undefined };
      const resolverService = { resolve: async () => ({}) };
      const warehousesService = {
        findById: async (id: string) => ({ id, branch_id: 'branch-evt-1' }),
      };

      const service = new EventsService(
        eventsRepo as any,
        sessionsRepo as any,
        devicesRepo as any,
        devicesService as any,
        auditRepo as any,
        resolverService as any,
        warehousesService as any,
        auditService,
      );

      await service.ingest(
        TENANT_A,
        {
          device_id: 'dev-3',
          raw_value: 'ABC123',
          scan_type: 'barcode',
          client_event_id: 'client-evt-1',
        } as any,
        ACTOR,
      );

      const scanRows = rows.filter((r) => r.action === 'scanner_event.ingested');
      expect(scanRows).toHaveLength(1);
      expect(scanRows[0].branch_id).toBe('branch-evt-1');
    });
  });

  describe('9. Legacy-style pre-existing audit rows (branch_id absent)', () => {
    it('defaults to NULL instead of throwing', async () => {
      const { rows, client } = makeFakeSupabase();
      const auditService = new AuditService(client as any);

      await expect(
        auditService.log({
          tenant_id: TENANT_A,
          actor_id: ACTOR,
          action: 'legacy.action',
          resource_type: 'legacy',
          resource_id: 'legacy-1',
          // branch_id intentionally omitted, simulating a pre-branch-system
          // call site that never knew this field existed.
        } as any),
      ).resolves.not.toThrow();

      expect(rows).toHaveLength(1);
      expect(rows[0].branch_id).toBeNull();
    });
  });

  describe('10. Inactive branch does not rewrite historical audit rows', () => {
    it('AuditService.log() only ever inserts, never validates or updates against branch status', async () => {
      const rows: Record<string, unknown>[] = [];
      let updateCalled = false;
      const client = {
        from: (table: string) => ({
          insert: (payload: Record<string, unknown>) => {
            if (table === 'audit_logs') rows.push(payload);
            return Promise.resolve({ error: null });
          },
          update: () => {
            updateCalled = true;
            return { eq: () => Promise.resolve({ error: null }) };
          },
        }),
      };
      const auditService = new AuditService(client as any);

      await auditService.log({
        tenant_id: TENANT_A,
        actor_id: ACTOR,
        action: 'work_center.created',
        resource_type: 'work_center',
        resource_id: 'wc-1',
        branch_id: 'branch-now-inactive',
      });

      // A branch being deactivated afterwards is a fact that lives in the
      // `branches` table, not something AuditService re-checks or mutates
      // old rows for — this insert-only call proves there is no update
      // path at all for audit_logs.branch_id.
      expect(updateCalled).toBe(false);
      expect(rows[0].branch_id).toBe('branch-now-inactive');
    });
  });

  describe('11. Cross-tenant branch id cannot be written', () => {
    it('resolveBranchForWarehouse only resolves warehouses within the caller\'s own tenant', async () => {
      const { rows, client } = makeFakeSupabase();
      const auditService = new AuditService(client as any);
      const devicesRepo = {
        create: async (_tenantId: string, payload: Record<string, unknown>) => ({
          id: 'dev-cross',
          ...payload,
        }),
        findById: async (id: string) => ({
          id,
          assigned_warehouse_id: 'wh-belongs-to-tenant-b',
        }),
      };
      // A tenant-scoped findById: the real WarehousesRepository always
      // filters `.eq('tenant_id', tenantId)`, so a warehouse that actually
      // belongs to tenant B returns no row when queried under tenant A's
      // id — resolveBranchForWarehouse always passes the *caller's own*
      // tenantId, so this correctly 404s (never leaks tenant B's
      // branch_id), and the try/catch turns that into null, exactly like a
      // missing warehouse.
      const warehousesService = {
        findById: async (_id: string, tenantId: string) => {
          if (tenantId === TENANT_A) {
            throw new Error('Warehouse not found');
          }
          return { id: 'wh-cross', branch_id: 'branch-tenant-b' };
        },
      };
      const service = new DevicesService(
        devicesRepo as any,
        warehousesService as any,
        auditService,
      );

      // Simulates tenant A's caller referencing a warehouse id that only
      // exists under tenant B.
      await service.create(
        TENANT_A,
        {
          device_code: 'DEV-CROSS',
          name: 'Cross-tenant device',
          device_type: 'usb_hid',
          assigned_warehouse_id: 'wh-belongs-to-tenant-b',
        } as any,
        ACTOR,
      );

      // findById above only returns tenant B's branch when called with
      // TENANT_B; called with TENANT_A (as resolveBranchForWarehouse always
      // does — it's given the caller's own tenantId) it throws, so no
      // cross-tenant branch_id is ever written.
      expect(rows[0].branch_id).toBeNull();

      // Sanity check: the same lookup under tenant B's own tenantId does
      // resolve — proving the null above is due to tenant scoping, not a
      // broken stub.
      const direct = await warehousesService.findById('wh-x', TENANT_B);
      expect(direct.branch_id).toBe('branch-tenant-b');
    });
  });

  describe('12. AuditInterceptor automatic path always writes null', () => {
    it('writes branch_id: null for any remaining @Audit()-decorated route', (done) => {
      const { rows, client } = makeFakeSupabase();
      const auditService = new AuditService(client as any);
      const reflector = {
        getAllAndOverride: () => 'quality_template.created',
      } as unknown as Reflector;
      const interceptor = new AuditInterceptor(auditService, reflector);

      const request = {
        user: { sub: ACTOR, role: 'admin' },
        tenantContext: { tenantId: TENANT_A },
        headers: {},
        params: { id: 'qt-1' },
      };
      const context = {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as any;

      // The interceptor pipes through rxjs `tap`, which needs a real
      // Observable to drive — build a minimal one that emits once and
      // completes, the way Nest's response pipeline would.
      const { Observable } = require('rxjs');
      const source$ = new Observable((subscriber: any) => {
        subscriber.next({ id: 'qt-1' });
        subscriber.complete();
      });
      const nextReal = { handle: () => source$ };

      const result$ = interceptor.intercept(context, nextReal as any);
      result$.subscribe({
        complete: () => {
          expect(rows).toHaveLength(1);
          expect(rows[0].branch_id).toBeNull();
          expect(rows[0].action).toBe('quality_template.created');
          done();
        },
      });
    });
  });

  describe('13. Previously missing audit events now produce records', () => {
    it('work_center.activated', async () => {
      const { rows, client } = makeFakeSupabase();
      const auditService = new AuditService(client as any);
      const workCentersRepo = {
        findById: async () => ({ id: 'wc-1', warehouse_id: 'wh-1' }),
        setActive: async () => ({ id: 'wc-1', is_active: true }),
      };
      const warehousesService = {
        findById: async () => ({ branch_id: 'branch-wc' }),
      };
      const service = new WorkCentersService(
        workCentersRepo as any,
        warehousesService as any,
        auditService,
      );

      await service.activate('wc-1', TENANT_A, ACTOR);

      expect(rows.some((r) => r.action === 'work_center.activated')).toBe(true);
    });

    it('work_center.deactivated', async () => {
      const { rows, client } = makeFakeSupabase();
      const auditService = new AuditService(client as any);
      const workCentersRepo = {
        findById: async () => ({ id: 'wc-1', warehouse_id: 'wh-1' }),
        setActive: async () => ({ id: 'wc-1', is_active: false }),
      };
      const warehousesService = {
        findById: async () => ({ branch_id: 'branch-wc' }),
      };
      const service = new WorkCentersService(
        workCentersRepo as any,
        warehousesService as any,
        auditService,
      );

      await service.deactivate('wc-1', TENANT_A, ACTOR);

      expect(rows.some((r) => r.action === 'work_center.deactivated')).toBe(
        true,
      );
    });

    it('quality_hold.released', async () => {
      const { rows, client } = makeFakeSupabase();
      const auditService = new AuditService(client as any);
      const holdsRepo = {
        findById: async () => ({
          id: 'hold-1',
          status: 'active',
          warehouse_id: 'wh-1',
        }),
        release: async () => ({ id: 'hold-1', status: 'released' }),
      };
      const warehousesService = {
        findById: async () => ({ branch_id: 'branch-hold' }),
      };
      const itemsService = {};
      const service = new HoldsService(
        holdsRepo as any,
        warehousesService as any,
        itemsService as any,
        auditService,
      );

      await service.release('hold-1', TENANT_A, ACTOR, {
        approved: true,
        reason: 'resolved',
      } as any);

      expect(rows.some((r) => r.action === 'quality_hold.released')).toBe(
        true,
      );
    });

    it('corrective_action.started', async () => {
      const { rows, client } = makeFakeSupabase();
      const auditService = new AuditService(client as any);
      const capaRepo = {
        findById: async () => ({ id: 'capa-1', status: 'assigned' }),
        updateStatus: async () => ({ id: 'capa-1', status: 'in_progress' }),
        recordHistory: async () => undefined,
      };
      const nonConformancesService = {};
      const service = new CorrectiveActionsService(
        capaRepo as any,
        nonConformancesService as any,
        auditService,
      );

      await service.start('capa-1', TENANT_A, ACTOR);

      expect(
        rows.some((r) => r.action === 'corrective_action.started'),
      ).toBe(true);
      // Documented domain-model gap: corrective_actions has no reliable
      // resource-branch path, so this is null by design, not an oversight.
      const record = rows.find((r) => r.action === 'corrective_action.started');
      expect(record?.branch_id).toBeNull();
    });
  });
});
