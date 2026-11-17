import { z } from 'zod';

import { parseWebhookUrl } from './address.js';
import {
  isWebhookEvent,
  MAX_SCHEDULE_AHEAD_MS,
  PUBLIC_PAGE_DEFAULT,
  PUBLIC_PAGE_MAX,
  WEBHOOK_EVENTS,
} from './events.js';

const webhookUrl = z.string().refine((value) => parseWebhookUrl(value).ok, 'Enter an HTTPS URL.');

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  mode: z.enum(['LIVE', 'TEST']),
});

export const updateApiKeySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  })
  .refine((value) => value.name !== undefined || value.status !== undefined, {
    message: 'Nothing to change.',
  });

export const publicSendSchema = z
  .object({
    to: z.string().trim().min(3).max(32),
    from: z.string().trim().min(1).max(15).optional(),
    text: z.string().min(1).max(1600).optional(),
    template_id: z.uuid().optional(),
    variables: z.record(z.string().regex(/^[a-z0-9_]+$/), z.string().max(500)).optional(),
    client_ref: z.string().trim().min(1).max(128).optional(),
    scheduled_at: z.iso.datetime().optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.text === undefined) === (value.template_id === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: 'Send text or a template_id, not both.',
      });
    }
    if (value.scheduled_at !== undefined) {
      const when = new Date(value.scheduled_at).getTime();
      const skew = Date.now() - 30_000;
      if (Number.isNaN(when) || when < skew) {
        ctx.addIssue({
          code: 'custom',
          path: ['scheduled_at'],
          message: 'scheduled_at must be in the future.',
        });
      }
      if (when > Date.now() + MAX_SCHEDULE_AHEAD_MS) {
        ctx.addIssue({
          code: 'custom',
          path: ['scheduled_at'],
          message: 'scheduled_at must be within 7 days.',
        });
      }
    }
  });

export const publicBatchSchema = z.object({
  messages: z.array(publicSendSchema).min(1).max(1000),
});

export const publicCursorQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PUBLIC_PAGE_MAX).default(PUBLIC_PAGE_DEFAULT),
  cursor: z.string().min(1).max(200).optional(),
});

export const publicMessageQuerySchema = publicCursorQuerySchema.extend({
  status: z
    .enum([
      'queued',
      'sending',
      'sent',
      'delivered',
      'undelivered',
      'expired',
      'failed',
      'rejected',
    ])
    .optional(),
  to: z.string().trim().min(1).max(32).optional(),
  client_ref: z.string().trim().min(1).max(128).optional(),
});

export const publicContactSchema = z.object({
  phone: z.string().trim().min(3).max(32),
  country: z.string().trim().length(2).optional(),
  name: z.string().trim().max(120).optional(),
  attributes: z.record(z.string().max(40), z.string().max(500)).optional(),
});

export const publicContactPatchSchema = z
  .object({
    name: z.string().trim().max(120).nullable().optional(),
    attributes: z.record(z.string().max(40), z.string().max(500)).optional(),
    opted_out: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined || value.attributes !== undefined || value.opted_out !== undefined,
    { message: 'Nothing to change.' },
  );

export const publicLookupSchema = z.object({
  phone: z.string().trim().min(3).max(32),
  country: z.string().trim().length(2).optional(),
});

const webhookEventList = z
  .array(z.string().refine(isWebhookEvent, 'Unknown event.'))
  .min(1)
  .max(WEBHOOK_EVENTS.length);

export const webhookWriteSchema = z.object({
  name: z.string().trim().min(1).max(80),
  url: webhookUrl,
  events: webhookEventList,
});

export const webhookPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    url: webhookUrl.optional(),
    events: webhookEventList.optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.url !== undefined ||
      value.events !== undefined ||
      value.status !== undefined,
    { message: 'Nothing to change.' },
  );

export const replaySchema = z.object({
  delivery_id: z.uuid(),
});
