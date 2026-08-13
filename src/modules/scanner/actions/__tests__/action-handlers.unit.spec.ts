import { ReceivingAction } from '../handlers/receiving.action';
import { PutawayAction } from '../handlers/putaway.action';
import { PickingAction } from '../handlers/picking.action';
import { PackingAction } from '../handlers/packing.action';
import { TransferAction } from '../handlers/transfer.action';
import { CountingAction } from '../handlers/counting.action';
import { ActionRequest } from '../action.types';
import { JwtPayload } from '../../../../shared/types/jwt-payload.type';
import { BadRequestException } from '@nestjs/common';

const TEST_USER: JwtPayload = {
  sub: 'user-1',
  email: 'worker@sefay.test',
  role: 'manager',
  roles: ['manager'],
  tenant_id: 'tenant-1',
  session_id: 'sess-1',
  business_type: null,
  activity: null,
};

function baseRequest(overrides: Partial<ActionRequest>): ActionRequest {
  return {
    tenantId: 'tenant-1',
    actorId: 'user-1',
    actionType: 'picking',
    resolution: { status: 'matched', entity_type: 'item', entity_id: 'item-1' },
    workflowContext: {},
    user: TEST_USER,
    ...overrides,
  };
}

describe('ReceivingAction mapping', () => {
  it('calls GoodsReceiptsService.post with the receipt id, tenant, and actor — never item/quantity details', async () => {
    const service = {
      post: jest.fn().mockResolvedValue({ status: 'received' }),
    };
    const action = new ReceivingAction(service as any);
    const result = await action.execute(
      baseRequest({
        actionType: 'receiving',
        workflowContext: { receipt_id: 'receipt-1' },
      }),
    );
    expect(service.post).toHaveBeenCalledWith(
      'receipt-1',
      'tenant-1',
      'user-1',
    );
    expect(result).toEqual({ status: 'received' });
  });

  it('throws when receipt_id is missing from workflowContext', async () => {
    const service = { post: jest.fn() };
    const action = new ReceivingAction(service as any);
    await expect(
      action.execute(
        baseRequest({ actionType: 'receiving', workflowContext: {} }),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(service.post).not.toHaveBeenCalled();
  });
});

describe('PutawayAction mapping', () => {
  it('forwards the resolved location id as confirmed_location_id', async () => {
    const service = {
      confirm: jest.fn().mockResolvedValue({ status: 'confirmed' }),
    };
    const action = new PutawayAction(service as any);
    await action.execute(
      baseRequest({
        actionType: 'putaway',
        resolution: {
          status: 'matched',
          entity_type: 'location',
          entity_id: 'loc-9',
        },
        workflowContext: { task_id: 'task-1', quantity: 10 },
      }),
    );
    expect(service.confirm).toHaveBeenCalledWith(
      'task-1',
      'tenant-1',
      10,
      'loc-9',
      'user-1',
    );
  });

  it('rejects a non-location resolution even if other fields are present', async () => {
    const service = { confirm: jest.fn() };
    const action = new PutawayAction(service as any);
    await expect(
      action.execute(
        baseRequest({
          actionType: 'putaway',
          resolution: {
            status: 'matched',
            entity_type: 'item',
            entity_id: 'item-1',
          },
          workflowContext: { task_id: 'task-1', quantity: 10 },
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('PickingAction mapping', () => {
  it('forwards batch_id only when the resolution is a batch', async () => {
    const service = { confirmPick: jest.fn().mockResolvedValue({}) };
    const action = new PickingAction(service as any);
    await action.execute(
      baseRequest({
        resolution: {
          status: 'matched',
          entity_type: 'batch',
          entity_id: 'batch-1',
        },
        workflowContext: { pick_list_line_id: 'line-1', quantity: 3 },
      }),
    );
    expect(service.confirmPick).toHaveBeenCalledWith(
      'line-1',
      'tenant-1',
      3,
      'user-1',
      'batch-1',
    );
  });

  it('omits batch_id when the resolution is a plain item', async () => {
    const service = { confirmPick: jest.fn().mockResolvedValue({}) };
    const action = new PickingAction(service as any);
    await action.execute(
      baseRequest({
        workflowContext: { pick_list_line_id: 'line-1', quantity: 3 },
      }),
    );
    expect(service.confirmPick).toHaveBeenCalledWith(
      'line-1',
      'tenant-1',
      3,
      'user-1',
      undefined,
    );
  });
});

describe('PackingAction mapping', () => {
  it('calls WmsService.confirmPack with the shipment line and quantity', async () => {
    const service = { confirmPack: jest.fn().mockResolvedValue({}) };
    const action = new PackingAction(service as any);
    await action.execute(
      baseRequest({
        actionType: 'packing',
        workflowContext: { shipment_line_id: 'sl-1', quantity: 2 },
      }),
    );
    expect(service.confirmPack).toHaveBeenCalledWith(
      'sl-1',
      'tenant-1',
      2,
      'user-1',
    );
  });
});

describe('TransferAction mapping', () => {
  it('calls TransfersService.receive with the transfer id, tenant, and actor', async () => {
    const service = {
      receive: jest.fn().mockResolvedValue({ status: 'received' }),
    };
    const action = new TransferAction(service as any);
    await action.execute(
      baseRequest({
        actionType: 'transfer',
        workflowContext: { transfer_id: 'tr-1' },
      }),
    );
    expect(service.receive).toHaveBeenCalledWith('tr-1', 'tenant-1', 'user-1');
  });
});

describe('CountingAction mapping', () => {
  it('calls CountsService.submitCount with counted_quantity from the scan workflow context', async () => {
    const service = { submitCount: jest.fn().mockResolvedValue({}) };
    const action = new CountingAction(service as any);
    await action.execute(
      baseRequest({
        actionType: 'counting',
        workflowContext: {
          count_id: 'c-1',
          count_item_id: 'ci-1',
          quantity: 7,
        },
      }),
    );
    expect(service.submitCount).toHaveBeenCalledWith(
      'c-1',
      'ci-1',
      'tenant-1',
      { counted_quantity: 7 },
    );
  });

  it('throws when count_item_id is missing', async () => {
    const service = { submitCount: jest.fn() };
    const action = new CountingAction(service as any);
    await expect(
      action.execute(
        baseRequest({
          actionType: 'counting',
          workflowContext: { count_id: 'c-1', quantity: 7 },
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
