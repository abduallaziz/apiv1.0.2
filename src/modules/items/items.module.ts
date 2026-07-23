import { Module } from '@nestjs/common';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { ItemsRepository } from './repositories/items.repository';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { CategoriesRepository } from './repositories/categories.repository';
import { UnitsController } from './units.controller';
import { UnitsService } from './units.service';
import { UnitsRepository } from './repositories/units.repository';
import { BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';
import { BrandsRepository } from './repositories/brands.repository';
import { ItemBarcodesController } from './item-barcodes.controller';
import { ItemBarcodesService } from './item-barcodes.service';
import { ItemBarcodesRepository } from './repositories/item-barcodes.repository';
import {
  SupabaseModule,
  SUPABASE_CLIENT,
} from '../../shared/supabase/supabase.module';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { SupabaseClient } from '@supabase/supabase-js';

@Module({
  imports: [SupabaseModule, PermissionsModule],
  controllers: [
    ItemsController,
    CategoriesController,
    UnitsController,
    BrandsController,
    ItemBarcodesController,
  ],
  providers: [
    ItemsService,
    CategoriesService,
    UnitsService,
    BrandsService,
    ItemBarcodesService,
    {
      provide: ItemsRepository,
      useFactory: (supabase: SupabaseClient) => new ItemsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: CategoriesRepository,
      useFactory: (supabase: SupabaseClient) =>
        new CategoriesRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: UnitsRepository,
      useFactory: (supabase: SupabaseClient) => new UnitsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: BrandsRepository,
      useFactory: (supabase: SupabaseClient) => new BrandsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: ItemBarcodesRepository,
      useFactory: (supabase: SupabaseClient) =>
        new ItemBarcodesRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
  ],
  exports: [ItemsService],
})
export class ItemsModule {}
