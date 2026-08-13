import { ResolvedEntityType } from '../resolver/resolver.types';
import { JwtPayload } from '../../../shared/types/jwt-payload.type';

// Action Framework (#21 Phase 7) — shared contracts.
//
// Core rule: this framework contains NO business logic. It only maps
// (Resolved Entity + Workflow Context + User Intent) -> a call to an
// EXISTING Sefay service's EXISTING public method. Every validation rule,
// stock mutation, cost calculation, and reservation/quality check already
// lives inside those services (or the DB functions they call) — this
// layer never duplicates any of it, never touches stock_movements/
// cost_layers/reservations directly, and never bypasses a service to call
// an RPC on its own.

export type ActionType =
  | 'receiving'
  | 'putaway'
  | 'picking'
  | 'packing'
  | 'shipping'
  | 'transfer'
  | 'counting'
  | 'manufacturing';

// The workflow-specific identifiers a caller already knows from the UI/
// session (which receipt, which pick line, which task) — the scan itself
// only supplies identity (via `resolution`) and, where relevant, a
// quantity. This mirrors how the existing controllers already work: e.g.
// WmsController.confirmPick(id, tenant, dto.quantity, user, dto.batch_id)
// takes the pick_list_line_id from the URL, not from the scan.
export interface ActionWorkflowContext {
  receipt_id?: string;
  task_id?: string;
  confirmed_location_id?: string;
  pick_list_line_id?: string;
  shipment_line_id?: string;
  shipment_id?: string;
  tracking_number?: string;
  transfer_id?: string;
  count_id?: string;
  count_item_id?: string;
  production_order_id?: string;
  quantity?: number;
}

export interface ActionRequest {
  tenantId: string;
  actorId: string;
  actionType: ActionType;
  // The scanner_events row that triggered this action, if any (an action
  // can also be invoked directly, e.g. a manual retry) — links the
  // scanner_actions audit row back to it.
  eventId?: string;
  resolution: {
    status: 'matched' | 'not_found' | 'ambiguous';
    entity_type: ResolvedEntityType | null;
    entity_id: string | null;
  };
  workflowContext: ActionWorkflowContext;
  // The authenticated Sefay user (the exact JWT payload shape TenantGuard/
  // JwtAuthGuard already attach to every HTTP request as `request.user`)
  // — NOT a caller-supplied permission list. ActionExecutorService
  // resolves what this user is actually allowed via the same
  // resolveUserPermission() PermissionGuard uses for every controller
  // route; nothing about "what this caller can do" is trusted from the
  // request itself.
  user: JwtPayload;
}

export interface ActionResult {
  success: boolean;
  action_type: ActionType;
  target_service: string;
  result?: Record<string, unknown>;
  error?: string;
}

export interface ActionDescriptor {
  actionType: ActionType;
  requiredEntityTypes: ResolvedEntityType[];
  requiredPermission: string;
  targetService: string;
  handler: IActionHandler;
}

export interface IActionHandler {
  // Executes the mapped call against the existing Sefay service. Must
  // return exactly what that service returned — no reshaping that could
  // hide a business-rule outcome, no synthesized success.
  execute(request: ActionRequest): Promise<Record<string, unknown>>;
}
