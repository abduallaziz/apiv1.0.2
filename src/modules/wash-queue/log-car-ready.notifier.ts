import { Injectable, Logger } from '@nestjs/common';
import { CarReadyNotifier, CarReadyPayload } from './car-ready-notifier';

// Default channel: "in-app". The board itself updates live through Supabase
// Realtime on wash_jobs, so the in-app notification is the status change plus
// this log line. Replace with a real channel by rebinding CAR_READY_NOTIFIER.
@Injectable()
export class LogCarReadyNotifier implements CarReadyNotifier {
  private readonly logger = new Logger(LogCarReadyNotifier.name);

  notify(p: CarReadyPayload): Promise<boolean> {
    this.logger.log(
      `Car ready: #${p.queueNumber} ${p.plate} (job ${p.jobId}, tenant ${p.tenantId})`,
    );
    return Promise.resolve(true);
  }
}
