import { Module } from '@nestjs/common';
import { ActivityProfilesController } from './activity-profiles.controller';
import { ActivityProfilesService } from './activity-profiles.service';

@Module({
  controllers: [ActivityProfilesController],
  providers: [ActivityProfilesService],
  exports: [ActivityProfilesService],
})
export class ActivityProfilesModule {}
