// G9 - "car ready" notification hook.
//
// The queue only knows this interface. The channel (in-app, SMS, WhatsApp,
// push ...) is pluggable: provide another class under CAR_READY_NOTIFIER in
// WashQueueModule. No SMS/WhatsApp provider is integrated - the provider and
// customer consent are still undecided - so the default implementation only
// logs. notify() resolves true when the channel actually delivered; the
// service then stamps wash_jobs.ready_notified_at. A throwing/false notifier
// never blocks the status change.
export interface CarReadyPayload {
  tenantId: string;
  jobId: string;
  branchId: string;
  plate: string;
  queueNumber: number;
  customerId: string | null;
  orderId: string | null;
}

export interface CarReadyNotifier {
  notify(payload: CarReadyPayload): Promise<boolean>;
}

export const CAR_READY_NOTIFIER = Symbol('CAR_READY_NOTIFIER');
