import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OperationsRepository } from './repositories/operations.repository';
import { ProductionOrdersRepository } from './repositories/production-orders.repository';
import { CreateOperationDto } from './dto/create-operation.dto';
import { UpdateOperationDto } from './dto/update-operation.dto';

@Injectable()
export class OperationsService {
  constructor(
    private readonly operationsRepo: OperationsRepository,
    private readonly productionOrdersRepo: ProductionOrdersRepository,
  ) {}

  private async assertOrderExists(productionOrderId: string, tenantId: string) {
    const order = await this.productionOrdersRepo.findById(
      productionOrderId,
      tenantId,
    );
    if (!order) throw new NotFoundException('Production order not found');
    return order;
  }

  findByProductionOrder(productionOrderId: string, tenantId: string) {
    return this.operationsRepo.findByProductionOrder(
      productionOrderId,
      tenantId,
    );
  }

  async create(
    productionOrderId: string,
    tenantId: string,
    dto: CreateOperationDto,
  ) {
    await this.assertOrderExists(productionOrderId, tenantId);
    return this.operationsRepo.create(productionOrderId, tenantId, {
      work_center_id: dto.work_center_id ?? null,
      sequence: dto.sequence,
      operation_name: dto.operation_name,
      duration_minutes: dto.duration_minutes ?? null,
    });
  }

  async update(
    operationId: string,
    productionOrderId: string,
    tenantId: string,
    dto: UpdateOperationDto,
  ) {
    await this.assertOrderExists(productionOrderId, tenantId);
    const existing = await this.operationsRepo.findById(operationId, tenantId);
    if (
      !existing ||
      (existing as any).production_order_id !== productionOrderId
    ) {
      throw new NotFoundException(
        'Operation not found on this production order',
      );
    }

    const payload: Record<string, unknown> = { ...dto };
    if (dto.status === 'in_progress' && !(existing as any).started_at) {
      payload.started_at = new Date().toISOString();
    }
    if (dto.status === 'completed' && !(existing as any).completed_at) {
      payload.completed_at = new Date().toISOString();
    }

    const updated = await this.operationsRepo.update(
      operationId,
      tenantId,
      payload,
    );
    if (!updated) throw new NotFoundException('Operation not found');
    return updated;
  }

  // Called by ProductionOrdersService.complete() — this table is 100%
  // opt-in (Migration 13.16A): zero operations rows means zero effect on
  // completion, exactly matching pre-existing behavior for every
  // production order that doesn't use routing.
  async assertAllOperationsComplete(
    productionOrderId: string,
    tenantId: string,
  ): Promise<void> {
    const operations = await this.operationsRepo.findByProductionOrder(
      productionOrderId,
      tenantId,
    );
    if (operations.length === 0) return;
    const incomplete = operations.filter(
      (op: any) => op.status !== 'completed',
    );
    if (incomplete.length > 0) {
      const names = incomplete.map((op: any) => op.operation_name).join(', ');
      throw new BadRequestException(
        `Cannot complete production order: operation(s) not yet completed: ${names}`,
      );
    }
  }
}
