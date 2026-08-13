import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BomRepository } from './repositories/bom.repository';
import { ItemsService } from '../items/items.service';
import { PaginationDto } from '../../shared/dto/pagination.dto';
import { CreateBomDto } from './dto/create-bom.dto';
import { UpdateBomDto } from './dto/update-bom.dto';
import { ReplaceBomLinesDto } from './dto/replace-bom-lines.dto';

@Injectable()
export class BomService {
  constructor(
    private readonly bomRepo: BomRepository,
    private readonly itemsService: ItemsService,
  ) {}

  async findAll(
    tenantId: string,
    page?: string,
    perPage?: string,
    itemId?: string,
    isActive?: string,
  ) {
    const pagination = new PaginationDto(page, perPage);
    const filters = {
      item_id: itemId,
      is_active: isActive === undefined ? undefined : isActive === 'true',
    };
    const { data, total } = await this.bomRepo.findAll(
      tenantId,
      pagination,
      filters,
    );
    return { data, total, page: pagination.page, perPage: pagination.perPage };
  }

  async findById(id: string, tenantId: string) {
    const bom: any = await this.bomRepo.findById(id, tenantId);
    if (!bom) throw new NotFoundException('BOM not found');
    const lines = await this.bomRepo.findLines(id, tenantId);
    return { ...bom, lines };
  }

  private async validateLines(
    tenantId: string,
    itemId: string,
    lines: { component_item_id: string }[],
  ) {
    for (const line of lines) {
      if (line.component_item_id === itemId) {
        throw new BadRequestException(
          'A BOM cannot include its own finished item as a component',
        );
      }
      await this.itemsService.findById(line.component_item_id, tenantId); // throws NotFoundException if missing
    }
  }

  async create(tenantId: string, dto: CreateBomDto) {
    await this.itemsService.findById(dto.item_id, tenantId); // throws NotFoundException if missing
    await this.validateLines(tenantId, dto.item_id, dto.lines);

    const isActive = dto.is_active ?? true;
    if (isActive) {
      await this.bomRepo.deactivateOthersForItem(
        tenantId,
        dto.item_id,
        dto.variant_id ?? null,
      );
    }

    const bom = await this.bomRepo.create(
      tenantId,
      {
        item_id: dto.item_id,
        variant_id: dto.variant_id ?? null,
        notes: dto.notes ?? null,
        is_active: isActive,
      },
      dto.lines.map((line) => ({
        component_item_id: line.component_item_id,
        component_variant_id: line.component_variant_id ?? null,
        quantity_per_unit: line.quantity_per_unit,
        scrap_percentage: line.scrap_percentage ?? 0,
      })),
    );

    return this.findById(bom.id, tenantId);
  }

  async update(id: string, tenantId: string, dto: UpdateBomDto) {
    await this.findById(id, tenantId);
    await this.bomRepo.update(id, tenantId, { notes: dto.notes });
    return this.findById(id, tenantId);
  }

  async replaceLines(id: string, tenantId: string, dto: ReplaceBomLinesDto) {
    const bom = await this.findById(id, tenantId);
    await this.validateLines(tenantId, bom.item_id, dto.lines);

    await this.bomRepo.replaceLines(
      id,
      tenantId,
      dto.lines.map((line) => ({
        component_item_id: line.component_item_id,
        component_variant_id: line.component_variant_id ?? null,
        quantity_per_unit: line.quantity_per_unit,
        scrap_percentage: line.scrap_percentage ?? 0,
      })),
    );

    return this.findById(id, tenantId);
  }

  async activate(id: string, tenantId: string) {
    const bom = await this.findById(id, tenantId);
    if (!bom.is_active) {
      await this.bomRepo.deactivateOthersForItem(
        tenantId,
        bom.item_id,
        bom.variant_id,
        id,
      );
      await this.bomRepo.setActive(id, tenantId, true);
    }
    return this.findById(id, tenantId);
  }

  async deactivate(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    await this.bomRepo.setActive(id, tenantId, false);
    return this.findById(id, tenantId);
  }
}
