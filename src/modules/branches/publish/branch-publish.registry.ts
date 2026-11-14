import { Injectable } from '@nestjs/common';
import { EntityPublisher } from './branch-publish.types';

/** Registry of publishable entity types. New types plug in with `register()` (design doc section 7). */
@Injectable()
export class BranchPublishRegistry {
  private readonly publishers = new Map<string, EntityPublisher>();

  register(publisher: EntityPublisher): this {
    if (this.publishers.has(publisher.type)) {
      throw new Error(`Publishable type "${publisher.type}" already registered`);
    }
    this.publishers.set(publisher.type, publisher);
    return this;
  }

  get(type: string): EntityPublisher | undefined {
    return this.publishers.get(type);
  }

  list(): EntityPublisher[] {
    return [...this.publishers.values()];
  }

  /** Types copied when a new branch asks for the main branch's setup. */
  setupTypes(): EntityPublisher[] {
    return this.list().filter((p) => p.supported && p.group === 'setup');
  }
}
