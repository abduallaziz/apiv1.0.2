import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { ScopedRepository } from '../../core/tenant/scoped.repository';
import { TenantContext } from '../../core/tenant/tenant-context';
import { CreateFieldDefinitionDto } from './dto/create-field-definition.dto';
import { UpdateFieldDefinitionDto } from './dto/update-field-definition.dto';
import { CustomerFieldDefinitionRow } from './customers.types';
import { isUniqueViolation } from '../../shared/supabase/postgrest-error.util';

@Injectable()
export class CustomerFieldDefinitionsRepository extends ScopedRepository {
  constructor(@Inject(SUPABASE_CLIENT) supabase: SupabaseClient) {
    super(supabase);
  }

  async findAll(tenant: TenantContext, activeOnly = false) {
    let query = this.scopedQuery('customer_field_definitions', tenant)
      .select(
        'id, field_key, label_ar, label_en, field_type, options, required, is_active, sort_order, contact_role, created_at',
      )
      .order('sort_order', { ascending: true });

    if (activeOnly) query = query.eq('is_active', true);

    const { data, error } = await query.returns<CustomerFieldDefinitionRow[]>();
    if (error) throw error;
    return data;
  }

  async findByKey(tenant: TenantContext, fieldKey: string) {
    const { data } = await this.scopedQuery(
      'customer_field_definitions',
      tenant,
    )
      .select('id')
      .eq('field_key', fieldKey)
      .maybeSingle<{ id: string }>();
    return data;
  }

  async findById(tenant: TenantContext, id: string) {
    const { data, error } = await this.scopedQuery(
      'customer_field_definitions',
      tenant,
    )
      .select('*')
      .eq('id', id)
      .maybeSingle<CustomerFieldDefinitionRow>();
    if (error) throw error;
    return data;
  }

  async create(tenant: TenantContext, dto: CreateFieldDefinitionDto) {
    const { data, error } = await this.supabase
      .from('customer_field_definitions')
      .insert({
        ...dto,
        tenant_id: tenant.tenantId,
        is_active: true,
      })
      .select()
      .single<CustomerFieldDefinitionRow>();
    if (error) {
      if (isUniqueViolation(error)) {
        throw new BadRequestException(
          'field_key already exists for this tenant',
        );
      }
      throw error;
    }
    return data;
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateFieldDefinitionDto,
  ) {
    const { data, error } = await this.supabase
      .from('customer_field_definitions')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId)
      .select()
      .single<CustomerFieldDefinitionRow>();
    if (error) throw error;
    return data;
  }

  async softDelete(tenant: TenantContext, id: string) {
    const { error } = await this.supabase
      .from('customer_field_definitions')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenant.tenantId);
    if (error) throw error;
  }
}
