import { Module } from '@nestjs/common';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { ItemsRepository } from './repositories/items.repository';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { CategoriesRepository } from './repositories/categories.repository';
import { SupabaseModule, SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { PermissionsModule } from '../../core/permissions/permissions.module';
import { SupabaseClient } from '@supabase/supabase-js';

@Module({
  imports: [SupabaseModule, PermissionsModule],
  controllers: [ItemsController, CategoriesController],
  providers: [
    ItemsService,
    CategoriesService,
    {
      provide: ItemsRepository,
      useFactory: (supabase: SupabaseClient) => new ItemsRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
    {
      provide: CategoriesRepository,
      useFactory: (supabase: SupabaseClient) => new CategoriesRepository(supabase),
      inject: [SUPABASE_CLIENT],
    },
  ],
  exports: [ItemsService],
})
export class ItemsModule {}