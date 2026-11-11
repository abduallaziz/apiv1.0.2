import { PartialType } from '@nestjs/mapped-types';
import { CreateItemAttributeDto } from './create-item-attribute.dto';

export class UpdateItemAttributeDto extends PartialType(
  CreateItemAttributeDto,
) {}
