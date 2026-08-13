/**
 * Regression suite for the Migration 13.21 Phase 7 authorization patch —
 * proves ActionExecutorService resolves permissions from the REAL Sefay
 * permission system (PermissionsService, backed by the real
 * role_permissions table), not a caller-supplied string[]. Runs directly
 * against the live Supabase project, same convention as every other
 * regression spec in this directory.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import 'reflect-metadata';
import { RedisCacheService } from '../../../core/cache/redis-cache.service';
import { PermissionsService } from '../../../core/permissions/permissions.service';
import { ActionExecutorService } from '../../../modules/scanner/actions/action-executor.service';
import { ActionRegistry } from '../../../modules/scanner/actions/action-registry';
import { ScannerActionsRepository } from '../../../modules/scanner/repositories/scanner-actions.repository';
import {
  ActionRequest,
  IActionHandler,
} from '../../../modules/scanner/actions/action.types';
import { JwtPayload } from '../../../shared/types/jwt-payload.type';

const TENANT = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo — an
// UNRESTRICTED_TEST_TENANT_ID, so it bypasses the permission gate on its
// own. A second, ordinary tenant id is used for the actual grant/deny
// assertions below so this suite exercises the real role_permissions
// lookup, not the QA-tenant bypass.
const ORDINARY_TENANT = '00000000-0000-0000-0000-0000000a11ce';

function makeUser(overrides: Partial<JwtPayload>): JwtPayload {
  return {
    sub: 'user-x',
    email: 'test@sefay.test',
    role: 'manager',
    roles: ['manager'],
    tenant_id: ORDINARY_TENANT,
    session_id: 'sess-x',
    business_type: null,
    activity: null,
    ...overrides,
  };
}

// A no-op in-memory stand-in for the real ScannerActionsRepository — this
// suite is about proving the PERMISSION SOURCE is real, not about
// re-testing the audit-write behavior already covered by
// action-executor.unit.spec.ts. Avoids writing rows against a tenant id
// that doesn't exist in the tenants table (scanner_actions.tenant_id has
// no FK, so it would technically succeed, but there is nothing to clean
// up either way — this keeps the suite side-effect-free on scanner_actions).
class NoopActionsRepository {
  create() {
    return Promise.resolve({ id: 'audit-noop' });
  }
  markSuccess() {
    return Promise.resolve();
  }
  markFailed() {
    return Promise.resolve();
  }
}

class StubHandler implements IActionHandler {
  public calls = 0;
  execute(): Promise<Record<string, unknown>> {
    this.calls++;
    return Promise.resolve({ status: 'ok' });
  }
}

describe('Action Framework authorization patch (Migration 13.21 Phase 7)', () => {
  let permissionsService: PermissionsService;
  let executor: ActionExecutorService;
  let stubHandler: StubHandler;

  beforeAll(() => {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
    // A cache that never hits Redis — this suite runs against real
    // role_permissions rows every call, deliberately, so a stale cache
    // entry from an earlier run can never mask a real regression.
    const passthroughCache = {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(undefined),
      del: () => Promise.resolve(undefined),
    } as unknown as RedisCacheService;
    permissionsService = new PermissionsService(supabase, passthroughCache);

    stubHandler = new StubHandler();
    const registry = {
      get: () => ({
        actionType: 'picking',
        requiredEntityTypes: ['item', 'variant', 'batch', 'serial'],
        requiredPermission: 'inventory.fulfill',
        targetService: 'WmsService.confirmPick',
        handler: stubHandler,
      }),
    } as unknown as ActionRegistry;

    executor = new ActionExecutorService(
      registry,
      new NoopActionsRepository() as unknown as ScannerActionsRepository,
      permissionsService,
    );
  });

  function baseRequest(user: JwtPayload): ActionRequest {
    return {
      tenantId: ORDINARY_TENANT,
      actorId: user.sub,
      actionType: 'picking',
      resolution: {
        status: 'matched',
        entity_type: 'item',
        entity_id: 'item-1',
      },
      workflowContext: { pick_list_line_id: 'line-1', quantity: 1 },
      user,
    };
  }

  it('a real permission source reaches ActionExecutorService: manager (grants inventory.fulfill in the seed) succeeds', async () => {
    stubHandler.calls = 0;
    const result = await executor.execute(
      baseRequest(makeUser({ role: 'manager', roles: ['manager'] })),
    );
    expect(result.success).toBe(true);
    expect(stubHandler.calls).toBe(1);
  });

  it('unauthorized action cannot execute: cashier (does not grant inventory.fulfill in the seed) is rejected before the handler runs', async () => {
    stubHandler.calls = 0;
    await expect(
      executor.execute(
        baseRequest(makeUser({ role: 'cashier', roles: ['cashier'] })),
      ),
    ).rejects.toThrow(/requires permission "inventory.fulfill"/);
    expect(stubHandler.calls).toBe(0);
  });

  it('superadmin behavior remains identical to existing Sefay rules: bypasses the check without a role_permissions lookup mattering', async () => {
    stubHandler.calls = 0;
    const result = await executor.execute(
      baseRequest(makeUser({ role: 'superadmin', roles: ['superadmin'] })),
    );
    expect(result.success).toBe(true);
    expect(stubHandler.calls).toBe(1);
  });

  it('the QA/demo tenant bypass (shared with every controller) also applies here, unchanged', async () => {
    stubHandler.calls = 0;
    const result = await executor.execute({
      ...baseRequest(
        makeUser({ role: 'cashier', roles: ['cashier'], tenant_id: TENANT }),
      ),
      tenantId: TENANT,
    });
    expect(result.success).toBe(true);
    expect(stubHandler.calls).toBe(1);
  });
});
