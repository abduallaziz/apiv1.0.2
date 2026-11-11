import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RewardInstancesRepository } from './reward-instances.repository';

/**
 * Daily reward expiration — 04:00 server-clock, matching this codebase's
 * existing scheduling convention (every other @Cron job here — expenses,
 * dunning, outbox relay, audit cleanup — runs on server clock; there is no
 * existing tenant-timezone-aware cron precedent to follow instead, despite
 * tenants.timezone existing). A global, single daily run rather than
 * per-tenant-timezone jobs, per Phase 10's instruction to use the existing
 * project scheduling convention rather than introduce a new one.
 */
@Injectable()
export class RewardExpirationScheduler {
  private readonly logger = new Logger(RewardExpirationScheduler.name);

  constructor(private readonly instancesRepo: RewardInstancesRepository) {}

  @Cron('0 4 * * *')
  async handleExpireRewards() {
    const count = await this.instancesRepo.expireDueInstances();
    if (count > 0) {
      this.logger.log(`Expired ${count} unlocked reward instance(s)`);
    }
  }
}
