import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ActionRegistry } from './action-registry';
import { ActionRequest, ActionResult } from './action.types';
import { ScannerActionsRepository } from '../repositories/scanner-actions.repository';
import { PermissionsService } from '../../../core/permissions/permissions.service';
import { resolveUserPermission } from '../../../core/permissions/permission-resolution.util';

// Flow: Scan Event -> Resolver Result -> Action Selection -> Existing
// Sefay Service -> Action Audit. This service performs the middle two
// steps and the final audit write; it never calls a Sefay repository/RPC
// directly to move stock, reserve inventory, or compute cost — every one
// of those still happens exclusively inside the target service it calls.
//
// Authorization: permission validation happens ONLY here (never inside a
// handler), and it is resolved from the real, authenticated Sefay
// permission system — resolveUserPermission() is the exact same function
// PermissionGuard calls for every HTTP-routed controller (#21 Phase 7
// authorization patch, closing the gap where this used to trust a
// caller-supplied string[]). Superadmin bypass, the QA/demo-tenant
// bypass, and the legacy/hybrid shadow comparison all behave identically
// to a normal controller request, because it is literally the same code
// path, not a re-implementation of it.
@Injectable()
export class ActionExecutorService {
  private readonly logger = new Logger(ActionExecutorService.name);

  constructor(
    private readonly registry: ActionRegistry,
    private readonly actionsRepo: ScannerActionsRepository,
    private readonly permissionsService: PermissionsService,
  ) {}

  async execute(request: ActionRequest): Promise<ActionResult> {
    const descriptor = this.registry.get(request.actionType);

    // Invalid entity handling: the resolver must have found exactly one
    // entity, and it must be one this action type accepts.
    if (
      request.resolution.status !== 'matched' ||
      !request.resolution.entity_type
    ) {
      throw new BadRequestException(
        `${request.actionType} action requires a matched scan resolution (got "${request.resolution.status}")`,
      );
    }
    if (
      !descriptor.requiredEntityTypes.includes(request.resolution.entity_type)
    ) {
      throw new BadRequestException(
        `${request.actionType} action requires one of [${descriptor.requiredEntityTypes.join(', ')}], got "${request.resolution.entity_type}"`,
      );
    }

    // Permission validation — resolved from the authenticated user via the
    // same primitive PermissionGuard uses, re-run here because this
    // framework calls the target service directly, bypassing that
    // controller's guard entirely.
    const granted = await resolveUserPermission(
      this.permissionsService,
      this.logger,
      request.user,
      descriptor.requiredPermission,
    );
    if (!granted) {
      throw new ForbiddenException(
        `${request.actionType} action requires permission "${descriptor.requiredPermission}"`,
      );
    }

    const auditRow = await this.actionsRepo.create(request.tenantId, {
      event_id: request.eventId ?? null,
      action_type: request.actionType,
      target_service: descriptor.targetService,
      target_reference_type: request.resolution.entity_type,
      target_reference_id: request.resolution.entity_id,
    });

    try {
      const result = await descriptor.handler.execute(request);
      await this.actionsRepo.markSuccess(auditRow.id, request.tenantId, result);
      return {
        success: true,
        action_type: request.actionType,
        target_service: descriptor.targetService,
        result,
      };
    } catch (error) {
      // Business-rule failures from the target service (e.g. "exceeds
      // remaining committed quantity", a quality hold, FEFO violation)
      // are expected operational outcomes, not framework bugs — recorded
      // on the audit row and returned as a structured failure rather than
      // left to crash uncaught. Validation errors above (bad entity type,
      // missing permission) are framework-level and still throw.
      const message = error instanceof Error ? error.message : String(error);
      await this.actionsRepo.markFailed(auditRow.id, request.tenantId, message);
      return {
        success: false,
        action_type: request.actionType,
        target_service: descriptor.targetService,
        error: message,
      };
    }
  }
}
