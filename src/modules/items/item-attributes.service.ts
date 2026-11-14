import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ItemAttributesRepository } from './repositories/item-attributes.repository';
import { CreateItemAttributeDto } from './dto/create-item-attribute.dto';
import { UpdateItemAttributeDto } from './dto/update-item-attribute.dto';
import { CreateItemAttributeValueDto } from './dto/create-item-attribute-value.dto';
import { UpdateItemAttributeValueDto } from './dto/update-item-attribute-value.dto';
import { AssignVariantAttributeDto } from './dto/assign-variant-attribute.dto';
import { isUniqueViolation } from '../../shared/supabase/postgrest-error.util';

@Injectable()
export class ItemAttributesService {
  constructor(private readonly attributesRepo: ItemAttributesRepository) {}

  // -- Attribute definitions ------------------------------------------------

  findAllAttributes(tenantId: string, branchId?: string | null) {
    return this.attributesRepo.findAllAttributes(tenantId, branchId);
  }

  async findAttributeById(
    id: string,
    tenantId: string,
    branchId?: string | null,
  ) {
    const attr = await this.attributesRepo.findAttributeById(
      id,
      tenantId,
      branchId,
    );
    if (!attr) throw new NotFoundException('Attribute not found');
    return attr;
  }

  async createAttribute(
    tenantId: string,
    dto: CreateItemAttributeDto,
    branchId?: string | null,
  ) {
    try {
      return await this.attributesRepo.createAttribute(
        tenantId,
        { ...dto },
        branchId,
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'An attribute with this name already exists',
        );
      }
      throw error;
    }
  }

  async updateAttribute(
    id: string,
    tenantId: string,
    dto: UpdateItemAttributeDto,
    branchId?: string | null,
  ) {
    await this.findAttributeById(id, tenantId, branchId);
    try {
      return await this.attributesRepo.updateAttribute(id, tenantId, {
        ...dto,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'An attribute with this name already exists',
        );
      }
      throw error;
    }
  }

  async removeAttribute(
    id: string,
    tenantId: string,
    branchId?: string | null,
  ) {
    await this.findAttributeById(id, tenantId, branchId);
    const inUse = await this.attributesRepo.countValuesInUse(id, tenantId);
    if (inUse > 0) {
      throw new ConflictException(
        `Cannot delete attribute: ${inUse} variant(s) currently use it`,
      );
    }
    await this.attributesRepo.deleteAttribute(id, tenantId);
  }

  // -- Attribute values -------------------------------------------------------

  async findValues(
    attributeId: string,
    tenantId: string,
    branchId?: string | null,
  ) {
    await this.findAttributeById(attributeId, tenantId, branchId);
    return this.attributesRepo.findValuesByAttribute(attributeId, tenantId);
  }

  async createValue(
    tenantId: string,
    dto: CreateItemAttributeValueDto,
    branchId?: string | null,
  ) {
    await this.findAttributeById(dto.item_attribute_id, tenantId, branchId);
    try {
      return await this.attributesRepo.createValue(tenantId, { ...dto });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'This value already exists for this attribute',
        );
      }
      throw error;
    }
  }

  async updateValue(
    id: string,
    tenantId: string,
    dto: UpdateItemAttributeValueDto,
    branchId?: string | null,
  ) {
    const existing = await this.attributesRepo.findValueById(id, tenantId);
    if (!existing) throw new NotFoundException('Attribute value not found');
    if (branchId) {
      await this.findAttributeById(
        existing.item_attribute_id,
        tenantId,
        branchId,
      );
    }
    try {
      return await this.attributesRepo.updateValue(id, tenantId, { ...dto });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'This value already exists for this attribute',
        );
      }
      throw error;
    }
  }

  async removeValue(id: string, tenantId: string, branchId?: string | null) {
    const existing = await this.attributesRepo.findValueById(id, tenantId);
    if (!existing) throw new NotFoundException('Attribute value not found');
    if (branchId) {
      await this.findAttributeById(
        existing.item_attribute_id,
        tenantId,
        branchId,
      );
    }
    await this.attributesRepo.deleteValue(id, tenantId);
  }

  // -- Variant assignments ----------------------------------------------------

  private async assertVariantInScope(
    variantId: string,
    tenantId: string,
    branchId?: string | null,
  ) {
    if (!branchId) return;
    if (
      !(await this.attributesRepo.variantInScope(variantId, tenantId, branchId))
    ) {
      throw new NotFoundException('Variant not found');
    }
  }

  async findAssignmentsForVariant(
    variantId: string,
    tenantId: string,
    branchId?: string | null,
  ) {
    await this.assertVariantInScope(variantId, tenantId, branchId);
    return this.attributesRepo.findAssignmentsForVariant(variantId, tenantId);
  }

  async assignToVariant(
    tenantId: string,
    dto: AssignVariantAttributeDto,
    branchId?: string | null,
  ) {
    await this.assertVariantInScope(dto.item_variant_id, tenantId, branchId);
    await this.findAttributeById(dto.item_attribute_id, tenantId, branchId);
    const value = await this.attributesRepo.findValueById(
      dto.item_attribute_value_id,
      tenantId,
    );
    if (!value || value.item_attribute_id !== dto.item_attribute_id) {
      throw new BadRequestException(
        'item_attribute_value_id does not belong to item_attribute_id',
      );
    }
    return this.attributesRepo.upsertAssignment(tenantId, { ...dto });
  }

  async removeAssignment(
    id: string,
    tenantId: string,
    branchId?: string | null,
  ) {
    if (branchId) {
      const row = await this.attributesRepo.findAssignmentById(id, tenantId);
      if (!row) throw new NotFoundException('Assignment not found');
      await this.assertVariantInScope(row.item_variant_id, tenantId, branchId);
    }
    await this.attributesRepo.removeAssignment(id, tenantId);
  }
}
