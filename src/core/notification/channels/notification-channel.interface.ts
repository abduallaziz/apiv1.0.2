export interface NotificationPayload {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface INotificationChannel {
  readonly channelName: string;
  send(payload: NotificationPayload): Promise<void>;
}