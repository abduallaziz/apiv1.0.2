import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotePresetsRepository } from './note-presets.repository';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CreateNotePresetDto } from './dto/create-note-preset.dto';
import { UpdateNotePresetDto } from './dto/update-note-preset.dto';
import { ReorderNotePresetsDto } from './dto/reorder-note-presets.dto';

@Injectable()
export class NotePresetsService {
  constructor(private readonly repo: NotePresetsRepository) {}

  findAll(tenant: TenantContext) {
    return this.repo.findAll(tenant);
  }

  findActive(tenant: TenantContext) {
    return this.repo.findActive(tenant);
  }

  async create(tenant: TenantContext, dto: CreateNotePresetDto) {
    const sort_order =
      dto.sort_order ?? (await this.repo.maxSortOrder(tenant)) + 1;
    return this.repo.create(tenant, { ...dto, sort_order });
  }

  async update(tenant: TenantContext, id: string, dto: UpdateNotePresetDto) {
    const existing = await this.repo.findById(tenant, id);
    if (!existing) throw new NotFoundException('Note preset not found');
    return this.repo.update(tenant, id, dto);
  }

  async remove(tenant: TenantContext, id: string) {
    const existing = await this.repo.findById(tenant, id);
    if (!existing) throw new NotFoundException('Note preset not found');
    await this.repo.softDelete(tenant, id);
    return { message: 'Note preset deleted' };
  }

  async reorder(tenant: TenantContext, dto: ReorderNotePresetsDto) {
    const all = await this.repo.findAll(tenant);
    const validIds = new Set(all.map((p: { id: string }) => p.id));
    const allBelongToTenant = dto.ids.every((id) => validIds.has(id));
    if (!allBelongToTenant || dto.ids.length !== all.length) {
      throw new BadRequestException(
        "The id list must exactly match this tenant's existing presets",
      );
    }
    return this.repo.reorder(tenant, dto.ids);
  }
}
