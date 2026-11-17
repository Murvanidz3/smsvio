/** Customer webhook events. `message.received` is selectable now and emitted when inbound SMS exists. */
export const WEBHOOK_EVENT_GROUPS = [
  {
    id: 'messages',
    label: 'Messages',
    events: [
      'message.queued',
      'message.sent',
      'message.delivered',
      'message.undelivered',
      'message.failed',
      'message.expired',
      'message.received',
    ],
  },
  {
    id: 'contacts',
    label: 'Contacts',
    events: ['contact.created', 'contact.updated', 'contact.deleted', 'contact.imported'],
  },
  {
    id: 'templates',
    label: 'Templates',
    events: [
      'template.created',
      'template.updated',
      'template.submitted',
      'template.approved',
      'template.deleted',
    ],
  },
  {
    id: 'senders',
    label: 'Senders',
    events: ['sender.requested', 'destination.enabled'],
  },
  {
    id: 'billing',
    label: 'Billing',
    events: ['billing.charged', 'billing.released', 'billing.adjusted'],
  },
] as const;

export const WEBHOOK_EVENTS = WEBHOOK_EVENT_GROUPS.flatMap((group) => group.events);

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

/**
 * Delays after each failed attempt. The first delivery is immediate.
 * The delays add up to a little under 24 hours.
 */
export const WEBHOOK_RETRY_DELAYS_MS = [
  10_000, 30_000, 120_000, 600_000, 1_800_000, 3_600_000, 7_200_000, 14_400_000, 28_800_000,
  28_800_000,
] as const;

/** Milliseconds to wait after this many failed attempts, or null when the schedule is finished. */
export function webhookRetryDelayMs(failedAttempts: number): number | null {
  const delay = WEBHOOK_RETRY_DELAYS_MS[failedAttempts - 1];
  return delay ?? null;
}

export const WEBHOOK_QUEUE_KEY = 'smsvio:q:webhook.deliver';
export const WEBHOOK_DELAY_KEY = 'smsvio:q:webhook.deliver:delay';

/** Per API key. The window is one second. */
export const API_KEY_RATE_LIMIT = 50;
export const API_KEY_RATE_WINDOW_MS = 1000;

export const PUBLIC_PAGE_DEFAULT = 25;
export const PUBLIC_PAGE_MAX = 100;

/** A send may be scheduled this far ahead. */
export const MAX_SCHEDULE_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;
