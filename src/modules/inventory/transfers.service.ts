import { Injectable, NotFoundException } from '@nestjs/common';
import { TransfersRepository } from './repositories/transfers.repository';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { throwFromRpcError } from './rpc-error.util';

@Injectable()
export class TransfersService {
  constructor(private readonly transfersRepo: TransfersRepository) {}

  findAll(tenantId: string, status?: string) {
    return this.transfersRepo.findAll(tenantId, status);
  }

  async findById(id: string, tenantId: string) {
    const transfer = await this.transfersRepo.findById(id, tenantId);
    if (!transfer) throw new NotFoundException('Transfer not found');
    return transfer;
  }

  create(tenantId: string, dto: CreateTransferDto) {
    const { items, ...header } = dto;
    return this.transfersRepo.create(
      tenantId,
      {
        from_warehouse_id: header.from_warehouse_id,
        to_warehouse_id: header.to_warehouse_id,
        transfer_number: header.transfer_number,
        notes: header.notes ?? null,
      },
      items.map((line) => ({
        item_id: line.item_id,
        variant_id: line.variant_id ?? null,
        batch_id: line.batch_id ?? null,
        quantity: line.quantity,
      })),
    );
  }

  async dispatch(id: string, tenantId: string, actorId: string) {
    await this.findById(id, tenantId);
    try {
      return await this.transfersRepo.dispatch(id, actorId);
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  async receive(id: string, tenantId: string, actorId: string) {
    await this.findById(id, tenantId);
    try {
      return await this.transfersRepo.receive(id, actorId);
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  async cancel(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.transfersRepo.cancel(id, tenantId);
  }
}
