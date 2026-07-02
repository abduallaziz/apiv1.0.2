import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomersRepository } from './customers.repository';
import { CustomerFieldDefinitionsController } from './customer-field-definitions.controller';
import { CustomerFieldDefinitionsService } from './customer-field-definitions.service';
import { CustomerFieldDefinitionsRepository } from './customer-field-definitions.repository';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
  imports: [TenantsModule],
  controllers: [CustomerFieldDefinitionsController, CustomersController],
  providers: [
    CustomersService,
    CustomersRepository,
    CustomerFieldDefinitionsService,
    CustomerFieldDefinitionsRepository,
  ],
  exports: [CustomersService],
})
export class CustomersModule {}