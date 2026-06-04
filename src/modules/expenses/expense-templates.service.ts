import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { Inject } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { CreateExpenseTemplateDto } from './dto/create-expense-template.dto';
import { UpdateExpenseTemplateDto } from './dto/update-expense-template.dto';

@Injectable()
export class ExpenseTemplatesService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findAll(tenantId: string) {
    const { data, error } = await this.supabase
      .from('expense_templates')
      .select('*')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data;
  }

  async findOne(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('expense_templates')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .single();

    if (error || !data) throw new NotFoundException('Expense template not found');
    return data;
  }

  async create(dto: CreateExpenseTemplateDto, tenantId: string) {
    const { data, error } = await this.supabase
      .from('expense_templates')
      .insert({
        tenant_id: tenantId,
        name: dto.name,
        default_amount: dto.default_amount ?? null,
        requires_photo: dto.requires_photo ?? false,
        expiry_hours: dto.expiry_hours,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async update(id: string, dto: UpdateExpenseTemplateDto, tenantId: string) {
    await this.findOne(id, tenantId);

    const { data, error } = await this.supabase
      .from('expense_templates')
      .update({ ...dto })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);

    const { error } = await this.supabase
      .from('expense_templates')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) throw new Error(error.message);
    return { success: true };
  }
}