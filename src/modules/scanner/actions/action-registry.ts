import { Injectable } from '@nestjs/common';
import { ActionDescriptor, ActionType } from './action.types';
import { ResolvedEntityType } from '../resolver/resolver.types';
import { ReceivingAction } from './handlers/receiving.action';
import { PutawayAction } from './handlers/putaway.action';
import { PickingAction } from './handlers/picking.action';
import { PackingAction } from './handlers/packing.action';
import { ShippingAction } from './handlers/shipping.action';
import { TransferAction } from './handlers/transfer.action';
import { CountingAction } from './handlers/counting.action';
import { ManufacturingAction } from './handlers/manufacturing.action';

const ITEM_LIKE: ResolvedEntityType[] = ['item', 'variant', 'batch', 'serial'];

// Static descriptor table — required entity types and the required
// permission are decided at design time from the SAME permission keys
// each target service's own controller already gates on (see the
// research this phase's design was built from: WmsController uses
// inventory.fulfill for confirmPick/confirmPack/shipShipment,
// GoodsReceiptsController uses purchasing.receive, etc.). The Action
// Framework enforces the same gate again here because it is invoked
// directly, bypassing those controllers.
@Injectable()
export class ActionRegistry {
  private readonly descriptors: Record<ActionType, ActionDescriptor>;

  constructor(
    receiving: ReceivingAction,
    putaway: PutawayAction,
    picking: PickingAction,
    packing: PackingAction,
    shipping: ShippingAction,
    transfer: TransferAction,
    counting: CountingAction,
    manufacturing: ManufacturingAction,
  ) {
    this.descriptors = {
      receiving: {
        actionType: 'receiving',
        requiredEntityTypes: ['item', 'variant'],
        requiredPermission: 'purchasing.receive',
        targetService: 'GoodsReceiptsService.post',
        handler: receiving,
      },
      putaway: {
        actionType: 'putaway',
        requiredEntityTypes: ['location'],
        requiredPermission: 'warehouse.approve',
        targetService: 'WarehouseTasksService.confirm',
        handler: putaway,
      },
      picking: {
        actionType: 'picking',
        requiredEntityTypes: ITEM_LIKE,
        requiredPermission: 'inventory.fulfill',
        targetService: 'WmsService.confirmPick',
        handler: picking,
      },
      packing: {
        actionType: 'packing',
        requiredEntityTypes: ITEM_LIKE,
        requiredPermission: 'inventory.fulfill',
        targetService: 'WmsService.confirmPack',
        handler: packing,
      },
      shipping: {
        actionType: 'shipping',
        requiredEntityTypes: ['location'],
        requiredPermission: 'inventory.fulfill',
        targetService: 'WmsService.shipShipment',
        handler: shipping,
      },
      transfer: {
        actionType: 'transfer',
        requiredEntityTypes: ITEM_LIKE,
        requiredPermission: 'inventory.transfer',
        targetService: 'TransfersService.receive',
        handler: transfer,
      },
      counting: {
        actionType: 'counting',
        requiredEntityTypes: ITEM_LIKE,
        requiredPermission: 'inventory.count',
        targetService: 'CountsService.submitCount',
        handler: counting,
      },
      manufacturing: {
        actionType: 'manufacturing',
        requiredEntityTypes: ['item', 'variant'],
        requiredPermission: 'manufacturing.execute',
        targetService: 'ProductionOrdersService.complete',
        handler: manufacturing,
      },
    };
  }

  get(actionType: ActionType): ActionDescriptor {
    const descriptor = this.descriptors[actionType];
    if (!descriptor)
      throw new Error(`No action registered for type "${actionType}"`);
    return descriptor;
  }

  list(): ActionDescriptor[] {
    return Object.values(this.descriptors);
  }
}
