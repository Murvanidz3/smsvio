import { z } from 'zod';

export const complianceBusinessSchema = z.object({
  legalName: z.string().trim().min(2).max(160),
  address: z.string().trim().min(4).max(300),
  website: z
    .string()
    .trim()
    .max(200)
    .refine((value) => value === '' || z.url().safeParse(value).success, 'Enter a valid URL.')
    .optional(),
  registrationNumber: z.string().trim().max(64).optional(),
  registrationCountry: z.string().regex(/^[A-Z]{2}$/),
});

export const useCaseSchema = z.object({
  purpose: z.string().trim().min(10).max(500),
  sample: z.string().trim().min(1).max(1000),
  optIn: z.string().trim().min(10).max(500),
});

export const complianceDocumentSchema = z.object({
  countryIso2: z.string().regex(/^[A-Z]{2}$/),
  kind: z.string().trim().min(2).max(40),
  filename: z.string().trim().min(1).max(120),
  contentType: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain']),
  dataBase64: z.string().trim().min(1).max(700_000),
});

export const autoReplySchema = z.object({
  category: z.enum(['HELP', 'OPT_IN', 'OPT_OUT', 'CUSTOM']),
  keywords: z.array(z.string().trim().min(2).max(32)).min(1).max(20),
  body: z.string().trim().min(1).max(480),
});

export const reviewDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(500).optional(),
});

export const adminMessageQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z
    .enum([
      'QUEUED',
      'SENDING',
      'SENT',
      'DELIVERED',
      'UNDELIVERED',
      'EXPIRED',
      'FAILED',
      'REJECTED',
    ])
    .optional(),
  organizationId: z.uuid().optional(),
  errorCode: z.string().trim().min(1).max(64).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => [10, 25, 50, 100].includes(value))
    .default(25),
});

export const statisticsQuerySchema = z.object({
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const sendingPauseSchema = z.object({
  paused: z.boolean(),
});
