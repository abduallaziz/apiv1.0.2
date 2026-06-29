import { Injectable, NotFoundException } from '@nestjs/common';
import { TransfersRepository } from './repositories/transfers.repository';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { throwFromRpcError } from './rpc-error.util';

@Injectable()
export class TransfersService {
  constructor(private readonly transfersRepo: TransfersRepository) {}

  async findAll(tenantId: string, status?: string) {
    const transfers = await this.transfersRepo.findAll(tenantId, status);
    return (transfers ?? []).map((t: any) => ({
      ...t,
      from_warehouse_name: t.from?.name ?? null,
      to_warehouse_name: t.to?.name ?? null,
    }));
  }

  async findById(id: string, tenantId: string) {
    const transfer: any = await this.transfersRepo.findById(id, tenantId);
    if (!transfer) throw new NotFoundException('Transfer not found');
    return {
      ...transfer,
      from_warehouse_name: transfer.from?.name ?? null,
      to_warehouse_name: transfer.to?.name ?? null,
      items: (transfer.items ?? []).map((item: any) => ({
        ...item,
        item_name: item.items?.name ?? null,
      })),
    };
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
