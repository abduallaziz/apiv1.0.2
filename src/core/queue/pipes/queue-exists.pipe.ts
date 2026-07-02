import { Injectable, PipeTransform, BadRequestException } from '@nestjs/common';
import { QueueRegistry } from '../queue.registry';

@Injectable()
export class QueueExistsPipe implements PipeTransform {
  constructor(private readonly registry: QueueRegistry) {}

  transform(value: string): string {
    if (!this.registry.exists(value)) {
      throw new BadRequestException(
        `Queue "${value}" not found. Available: ${this.registry.getNames().join(', ')}`,
      );
    }
    return value;
  }
}