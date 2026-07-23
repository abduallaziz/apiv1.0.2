import { PartialType } from '@nestjs/mapped-types';
import { CreateSupplierCatalogDto } from './create-supplier-catalog.dto';

export class UpdateSupplierCatalogDto extends PartialType(
  CreateSupplierCatalogDto,
) {}
