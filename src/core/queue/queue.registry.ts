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
  ) {
    this.map = {
      [QUEUE_NAMES.DUNNING]: this.dunningQueue,
      [QUEUE_NAMES.AUDIT_CLEANUP]: this.auditCleanupQueue,
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