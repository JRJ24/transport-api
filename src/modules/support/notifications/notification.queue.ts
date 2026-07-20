/** BullMQ queue name for asynchronous push delivery. */
export const NOTIFICATIONS_QUEUE = 'notifications';

/** Job name for a "send one notification" job. */
export const SEND_NOTIFICATION_JOB = 'send-notification';

export interface SendNotificationJob {
  notificationId: string;
}
