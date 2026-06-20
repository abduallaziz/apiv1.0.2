import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { BranchesRepository } from './branches.repository';

@Module({
  imports: [],
  controllers: [BranchesController],
  providers: [BranchesService, BranchesRepository],
  exports: [BranchesService, BranchesRepository],
})
export class BranchesModule {}