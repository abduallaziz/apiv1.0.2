import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from './queue.constants';

@Injectable()
export class QueueRegistry {
  private readonly map: Record<string, Queue>;

  constructor(
    @InjectQueue(QUEUE_NAMES.DUNNING) private readonly dunningQueue: Queue,
    @InjectQueue(QUEUE_NAMES.AUDIT_CLEANUP) private readonly auditCleanupQueue: Queue,
    @InjectQueue(QUEUE_NAMES.DOMAIN_EVENTS) private readonly domainEventsQueue: Queue,
    @InjectQueue(QUEUE_NAMES.AI) private readonly aiQueue: Queue,
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly notificationsQueue: Queue,
    @InjectQueue(QUEUE_NAMES.ANALYTICS) private readonly analyticsQueue: Queue,
  ) {
    this.map = {
      [QUEUE_NAMES.DUNNING]: this.dunningQueue,
      [QUEUE_NAMES.AUDIT_CLEANUP]: this.auditCleanupQueue,
      [QUEUE_NAMES.DOMAIN_EVENTS]: this.domainEventsQueue,
      [QUEUE_NAMES.AI]: this.aiQueue,
      [QUEUE_NAMES.NOTIFICATIONS]: this.notificationsQueue,
      [QUEUE_NAMES.ANALYTICS]: this.analyticsQueue,
    };
  }

  getNames(): string[] {
    return Object.keys(this.map);
  }

  get(name: string): Queue | undefined {
    return this.map[name];
  }

  exists(name: string): boolean {
    return name in this.map;
  }
}