import { Injectable, NotFoundException } from '@nestjs/common';
import { SerialsRepository } from './repositories/serials.repository';

interface SerialRow {
  id: string;
  status: string;
  created_at: string;
  sold_at: string | null;
  sold_order_id: string | null;
  warranty_expires_at: string | null;
  updated_at: string;
  [key: string]: unknown;
}

@Injectable()
export class SerialsService {
  constructor(private readonly serialsRepo: SerialsRepository) {}

  async findById(id: string, tenantId: string) {
    const serial = await this.serialsRepo.findById(id, tenantId);
    if (!serial) throw new NotFoundException('Serial not found');
    return serial;
  }

  async findByNumber(serialNumber: string, tenantId: string) {
    const results = await this.serialsRepo.findByNumber(serialNumber, tenantId);
    if (!results || results.length === 0) {
      throw new NotFoundException('No serial found with this number');
    }
    return results;
  }

  findByItem(itemId: string, tenantId: string, status?: string) {
    return this.serialsRepo.findByItem(itemId, tenantId, status);
  }

  findByWarehouse(warehouseId: string, tenantId: string, status?: string) {
    return this.serialsRepo.findByWarehouse(warehouseId, tenantId, status);
  }

  // Phase 4 — Customer History. Answers "who bought this unit, when, which
  // order" by reusing the existing orders.customer_id relationship — no new
  // direct customer_id column on item_serials.
  async findByCustomer(customerId: string, tenantId: string) {
    return this.serialsRepo.findByCustomer(customerId, tenantId);
  }

  async getCustomerHistory(id: string, tenantId: string) {
    const serial: any = await this.findById(id, tenantId);
    if (!serial.sold_order_id) {
      return { sold: false, order: null, customer: null };
    }
    const order = await this.serialsRepo.findOrderCustomer(serial.sold_order_id, tenantId);
    return {
      sold: true,
      order_id: serial.sold_order_id,
      sold_at: serial.sold_at,
      order,
      customer: order?.customers ?? null,
    };
  }

  // Phase 5 — Warranty. active/expired is computed on read, not stored —
  // warranty_expires_at is the only stored fact (already set by
  // fn_sell_serial); "is it currently active" is a point-in-time
  // calculation, not new state.
  async getWarrantyStatus(id: string, tenantId: string) {
    const serial: any = await this.findById(id, tenantId);
    if (!serial.warranty_expires_at) {
      return {
        has_warranty: false,
        status: 'none' as const,
        warranty_months: serial.warranty_months,
        warranty_expires_at: null,
        days_remaining: null,
      };
    }
    const expiresAt = new Date(serial.warranty_expires_at);
    const now = new Date();
    const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / 86400000);
    return {
      has_warranty: true,
      status: daysRemaining >= 0 ? ('active' as const) : ('expired' as const),
      warranty_months: serial.warranty_months,
      warranty_expires_at: serial.warranty_expires_at,
      days_remaining: daysRemaining >= 0 ? daysRemaining : null,
    };
  }

  // Lifecycle history is derived from the fields already on the row
  // (created_at, sold_at/sold_order_id, updated_at+status) rather than a
  // new event-log table — no new audit mechanism, per approved scope.
  async getLifecycleHistory(id: string, tenantId: string) {
    const serial = (await this.findById(id, tenantId)) as unknown as SerialRow;
    const events: { event: string; at: string; detail?: Record<string, unknown> }[] = [
      { event: 'created', at: serial.created_at },
    ];
    if (serial.sold_at) {
      events.push({ event: 'sold', at: serial.sold_at, detail: { order_id: serial.sold_order_id } });
    }
    if (serial.status === 'returned' || serial.status === 'scrapped') {
      events.push({ event: serial.status, at: serial.updated_at });
    }
    events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return { serial_id: id, current_status: serial.status, events };
  }
}
