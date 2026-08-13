import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupplierQuotesRepository } from './repositories/supplier-quotes.repository';
import { CreateSupplierQuoteDto } from './dto/create-supplier-quote.dto';

@Injectable()
export class SupplierQuotesService {
  constructor(private readonly supplierQuotesRepo: SupplierQuotesRepository) {}

  async findAllForRfq(rfqId: string, tenantId: string) {
    return this.supplierQuotesRepo.findAllForRfq(rfqId, tenantId);
  }

  async findById(id: string, tenantId: string) {
    const quote = await this.supplierQuotesRepo.findById(id, tenantId);
    if (!quote) throw new NotFoundException('Supplier quote not found');
    return quote;
  }

  // Creates version 1 the first time a supplier's quote is entered for an
  // RFQ; any subsequent call for the same (rfq, supplier) is a REVISION —
  // the previous version is marked 'superseded' and a new version is
  // inserted under the same quote_group_id. Never edits an existing row.
  async createOrRevise(
    tenantId: string,
    dto: CreateSupplierQuoteDto,
    createdBy: string,
  ) {
    const { items, rfq_id, supplier_id, ...header } = dto;
    let group = await this.supplierQuotesRepo.findGroup(
      rfq_id,
      supplier_id,
      tenantId,
    );
    if (!group) {
      // quote_number identifies the document itself (the quote_group) and
      // is only ever set once, on its first version — every later
      // revision reuses it, exactly like an amended document keeps its
      // original number.
      if (!header.quote_number) {
        throw new ConflictException(
          'quote_number is required for the first quote to this supplier on this RFQ',
        );
      }
      group = await this.supplierQuotesRepo.createGroup(
        tenantId,
        rfq_id,
        supplier_id,
        header.quote_number,
      );
    }

    const latest = await this.supplierQuotesRepo.findLatestVersion(
      group.id,
      tenantId,
    );
    const nextVersion = latest ? latest.version + 1 : 1;
    if (
      latest &&
      !['superseded', 'rejected', 'expired'].includes(latest.status)
    ) {
      await this.supplierQuotesRepo.supersede(latest.id, tenantId);
    }

    return this.supplierQuotesRepo.create(
      tenantId,
      group.id,
      nextVersion,
      {
        currency: header.currency ?? 'SAR',
        expiration_date: header.expiration_date ?? null,
        notes: header.notes ?? null,
      },
      items.map((line) => ({
        rfq_item_id: line.rfq_item_id ?? null,
        item_id: line.item_id,
        variant_id: line.variant_id ?? null,
        quantity_offered: line.quantity_offered,
        unit_price: line.unit_price,
        discount_percent: line.discount_percent ?? 0,
        currency: line.currency ?? null,
        lead_time_days: line.lead_time_days ?? null,
        moq: line.moq ?? null,
        tax_rate: line.tax_rate ?? null,
        notes: line.notes ?? null,
      })),
      createdBy,
    );
  }

  async submit(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.supplierQuotesRepo.submit(id, tenantId);
  }

  async reject(id: string, tenantId: string) {
    const quote = await this.findById(id, tenantId);
    if (!['draft', 'submitted'].includes(quote.status)) {
      throw new BadRequestException(
        `Cannot reject supplier quote with status: ${quote.status}`,
      );
    }
    return this.supplierQuotesRepo.reject(id, tenantId);
  }
}
