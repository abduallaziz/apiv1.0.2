import { ActionExecutorService } from '../action-executor.service';
import { ActionRegistry } from '../action-registry';
import { ActionRequest } from '../action.types';
import { JwtPayload } from '../../../../shared/types/jwt-payload.type';

const MANAGER_USER: JwtPayload = {
  sub: 'user-1',
  email: 'manager@sefay.test',
  role: 'manager',
  roles: ['manager'],
  tenant_id: 'tenant-1',
  session_id: 'sess-1',
  business_type: null,
  activity: null,
};

function makeRequest(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    tenantId: 'tenant-1',
    actorId: 'user-1',
    actionType: 'picking',
    resolution: { status: 'matched', entity_type: 'item', entity_id: 'item-1' },
    workflowContext: { pick_list_line_id: 'line-1', quantity: 5 },
    user: MANAGER_USER,
    ...overrides,
  };
}

describe('ActionExecutorService', () => {
  function setup(
    options: {
      handlerImpl?: () => Promise<Record<string, unknown>>;
      granted?: boolean;
    } = {},
  ) {
    const handler = {
      execute: jest.fn(
        options.handlerImpl ?? (() => Promise.resolve({ status: 'ok' })),
      ),
    };
    const registry = {
      get: jest.fn().mockReturnValue({
        actionType: 'picking',
        requiredEntityTypes: ['item', 'variant', 'batch', 'serial'],
        requiredPermission: 'inventory.fulfill',
        targetService: 'WmsService.confirmPick',
        handler,
      }),
    } as unknown as ActionRegistry;
    const actionsRepo = {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      markSuccess: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    const granted = options.granted ?? true;
    const permissionsService = {
      hasPermission: jest.fn().mockResolvedValue(granted),
      hasPermissionForUser: jest.fn().mockResolvedValue(granted),
    };
    const executor = new ActionExecutorService(
      registry,
      actionsRepo as any,
      permissionsService as any,
    );
    return { executor, registry, actionsRepo, handler, permissionsService };
  }

  it('rejects a request whose resolution did not match', async () => {
    const { executor } = setup();
    await expect(
      executor.execute(
        makeRequest({
          resolution: {
            status: 'not_found',
            entity_type: null,
            entity_id: null,
          },
        }),
      ),
    ).rejects.toThrow('requires a matched scan resolution');
  });

  it('rejects a request whose resolved entity_type is not in requiredEntityTypes', async () => {
    const { executor } = setup();
    await expect(
      executor.execute(
        makeRequest({
          resolution: {
            status: 'matched',
            entity_type: 'location',
            entity_id: 'loc-1',
          },
        }),
      ),
    ).rejects.toThrow(/requires one of/);
  });

  it('resolves permission via the real PermissionsService (role + tenant), not a trusted list', async () => {
    const { executor, permissionsService } = setup();
    await executor.execute(makeRequest());
    expect(permissionsService.hasPermission).toHaveBeenCalledWith(
      'manager',
      'inventory.fulfill',
      'tenant-1',
    );
    expect(permissionsService.hasPermissionForUser).toHaveBeenCalledWith(
      'user-1',
      'inventory.fulfill',
      'tenant-1',
    );
  });

  it('rejects a request from a user PermissionsService denies', async () => {
    const { executor, handler } = setup({ granted: false });
    await expect(executor.execute(makeRequest())).rejects.toThrow(
      /requires permission/,
    );
    expect(handler.execute).not.toHaveBeenCalled();
  });

  it('superadmin bypasses the permission check entirely, without calling PermissionsService', async () => {
    const { executor, permissionsService } = setup({ granted: false }); // even if PermissionsService would deny
    const superadmin: JwtPayload = {
      ...MANAGER_USER,
      role: 'superadmin',
      roles: ['superadmin'],
    };
    const result = await executor.execute(makeRequest({ user: superadmin }));
    expect(result.success).toBe(true);
    expect(permissionsService.hasPermission).not.toHaveBeenCalled();
    expect(permissionsService.hasPermissionForUser).not.toHaveBeenCalled();
  });

  it('creates a pending audit row before calling the handler, then marks it success', async () => {
    const { executor, actionsRepo, handler } = setup();
    const result = await executor.execute(makeRequest());

    expect(actionsRepo.create).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        action_type: 'picking',
        target_service: 'WmsService.confirmPick',
        target_reference_type: 'item',
        target_reference_id: 'item-1',
      }),
    );
    expect(handler.execute).toHaveBeenCalledTimes(1);
    expect(actionsRepo.markSuccess).toHaveBeenCalledWith(
      'audit-1',
      'tenant-1',
      { status: 'ok' },
    );
    expect(result).toEqual({
      success: true,
      action_type: 'picking',
      target_service: 'WmsService.confirmPick',
      result: { status: 'ok' },
    });
  });

  it('catches a target-service failure, marks the audit row failed, and returns a structured failure', async () => {
    const { executor, actionsRepo } = setup({
      handlerImpl: () =>
        Promise.reject(new Error('exceeds remaining committed quantity')),
    });
    const result = await executor.execute(makeRequest());

    expect(actionsRepo.markFailed).toHaveBeenCalledWith(
      'audit-1',
      'tenant-1',
      'exceeds remaining committed quantity',
    );
    expect(result).toEqual({
      success: false,
      action_type: 'picking',
      target_service: 'WmsService.confirmPick',
      error: 'exceeds remaining committed quantity',
    });
  });
});
