import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { PlansService } from './plans.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { SkipTenant } from '../../core/tenant/skip-tenant.decorator';

@Controller('plans')
@UseGuards(JwtAuthGuard)
@SkipTenant()
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  findAll() {
    return this.plansService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.plansService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreatePlanDto) {
    return this.plansService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreatePlanDto>) {
    return this.plansService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.plansService.remove(id);
  }
}