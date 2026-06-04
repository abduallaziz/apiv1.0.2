import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/supabase/supabase.module';
import { CreatePlanDto } from './dto/create-plan.dto';

@Injectable()
export class PlansService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findAll() {
    const { data, error } = await this.supabase
      .from('plans')
      .select('*')
      .order('price_monthly', { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async findOne(id: string) {
    const { data, error } = await this.supabase
      .from('plans')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) throw new NotFoundException('Plan not found');
    return data;
  }

  async create(dto: CreatePlanDto) {
    const { data, error } = await this.supabase
      .from('plans')
      .insert({
        ...dto,
        trial_days: dto.trial_days ?? 14,
        is_active: dto.is_active ?? true,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async update(id: string, dto: Partial<CreatePlanDto>) {
    const { data, error } = await this.supabase
      .from('plans')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async remove(id: string) {
    const { error } = await this.supabase
      .from('plans')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new Error(error.message);
    return { success: true };
  }
}