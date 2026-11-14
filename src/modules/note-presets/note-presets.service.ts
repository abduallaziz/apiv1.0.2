import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { toEnglishDigits } from '../customers/customer-normalize';
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

  /** English digits, trimmed, collapsed spaces (the stored form). */
  private clean(text: string): string {
    return toEnglishDigits(text).replace(/\s+/g, ' ').trim();
  }

  /** B-24: the same text (case-insensitive) cannot exist twice. */
  private async assertNotDuplicate(
    tenant: TenantContext,
    text: string,
    exceptId?: string,
  ) {
    const all = (await this.repo.findAll(tenant)) as {
      id: string;
      text: string;
    }[];
    const key = text.toLowerCase();
    if (all.some((p) => p.id !== exceptId && p.text.toLowerCase() === key)) {
      throw new ConflictException(
        'A note preset with this text already exists',
      );
    }
  }

  async create(tenant: TenantContext, rawDto: CreateNotePresetDto) {
    const dto = { ...rawDto, text: this.clean(rawDto.text) };
    if (!dto.text) throw new BadRequestException('text must not be empty');
    await this.assertNotDuplicate(tenant, dto.text);
    const sort_order =
      dto.sort_order ?? (await this.repo.maxSortOrder(tenant)) + 1;
    return this.repo.create(tenant, { ...dto, sort_order });
  }

  async update(tenant: TenantContext, id: string, rawDto: UpdateNotePresetDto) {
    const existing = await this.repo.findById(tenant, id);
    if (!existing) throw new NotFoundException('Note preset not found');
    const dto = { ...rawDto };
    if (dto.text !== undefined) {
      dto.text = this.clean(dto.text);
      if (!dto.text) throw new BadRequestException('text must not be empty');
      await this.assertNotDuplicate(tenant, dto.text, id);
    }
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
