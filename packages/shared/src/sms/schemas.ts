import { z } from 'zod';

import { PAGE_SIZES } from '../auth/constants.js';
import { templateDefinitionSchema } from './template.js';

const pageSizeSchema = z.coerce
  .number()
  .int()
  .refine(
    (value) => (PAGE_SIZES as readonly number[]).includes(value),
    'Choose 10, 25, 50, or 100.',
  );

const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'Choose a country.');

export const contactListSchema = z.object({
  q: z.string().trim().max(80).optional(),
  country: countryCodeSchema.optional(),
  optedOut: z.enum(['yes', 'no']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: pageSizeSchema.default(10),
  sort: z.enum(['createdAt', 'name', 'phone']).default('createdAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});

export const createContactSchema = z.object({
  phone: z.string().trim().min(1).max(32),
  country: countryCodeSchema.optional(),
  name: z.string().trim().max(120).optional(),
});

export const importContactsSchema = z.object({
  csv: z.string().min(1).max(500_000),
  hasHeader: z.boolean(),
  phoneColumn: z.number().int().min(0).max(40),
  nameColumn: z.number().int().min(0).max(40).nullable(),
  countryColumn: z.number().int().min(0).max(40).nullable(),
});

export const templateListSchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED']).optional(),
  category: z.enum(['AUTHENTICATION', 'UTILITY', 'MARKETING']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: pageSizeSchema.default(10),
});

export const saveTemplateSchema = templateDefinitionSchema;

export const galleryCopySchema = z.object({
  id: z.string().trim().min(1).max(80),
});

export const lookupSchema = z.object({
  phone: z.string().trim().min(1).max(32),
  country: countryCodeSchema.optional(),
});

export const sendMessageSchema = z
  .object({
    templateId: z.uuid(),
    variables: z.record(z.string().regex(/^[a-z0-9_]+$/), z.string().max(200)).optional(),
    to: z.string().trim().min(1).max(32).optional(),
    country: countryCodeSchema.optional(),
    contactId: z.uuid().optional(),
    senderId: z.uuid().nullable().optional(),
    clientRef: z.string().trim().min(1).max(80).optional(),
  })
  .refine((value) => value.to !== undefined || value.contactId !== undefined, {
    message: 'Enter a phone number or choose a contact.',
  });

export const messageListSchema = z.object({
  q: z.string().trim().max(80).optional(),
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
  direction: z.enum(['OUTBOUND', 'INBOUND']).optional(),
  country: countryCodeSchema.optional(),
  templateId: z.uuid().optional(),
  apiKeyId: z.uuid().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date.')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date.')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: pageSizeSchema.default(10),
});

export const analyticsQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((value) => value === 7 || value === 30 || value === 90, {
      message: 'Choose 7, 30, or 90 days.',
    }),
});
