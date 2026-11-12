import { z } from 'zod';

import { MAX_MARKUP_PERCENT } from './money.js';

const pageSizeSchema = z.coerce
  .number()
  .int()
  .refine((value) => [10, 25, 50, 100].includes(value), 'Choose 10, 25, 50, or 100.');

export const adminListSchema = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: pageSizeSchema.default(25),
  organizationId: z.uuid().optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  providerId: z.uuid().optional(),
});

export const providerCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .regex(/^[a-z][a-z0-9_]*$/, 'Use lowercase letters, digits, and underscores.');

export const markupSchema = z.number().int().min(0).max(MAX_MARKUP_PERCENT);

export const createProviderSchema = z.object({
  code: providerCodeSchema,
  type: z.enum(['MOCK', 'SMPP', 'HTTP']),
  markupPercent: markupSchema,
  maxTps: z.number().int().min(1).max(10_000),
  config: z.string().trim().max(8000).optional(),
});

export const updateProviderSchema = z.object({
  markupPercent: markupSchema,
  maxTps: z.number().int().min(1).max(10_000),
  status: z.enum(['ACTIVE', 'DISABLED']),
  config: z.string().trim().max(8000).optional(),
  rotateSecret: z.boolean().optional(),
});

const mccmncSchema = z
  .string()
  .regex(/^\d{5,6}$/, 'Network must be a 5–6 digit MCCMNC.')
  .nullable();

export const createRouteSchema = z.object({
  countryIso2: z.string().regex(/^[A-Z]{2}$/),
  mccmnc: mccmncSchema,
  providerId: z.uuid(),
  priority: z.number().int().min(1).max(10_000),
  weight: z.number().int().min(1).max(10_000),
  cost: z.string().trim().min(1).max(20),
  markupPercent: markupSchema.nullable(),
  enabled: z.boolean(),
});

export const updateRouteSchema = createRouteSchema.pick({
  priority: true,
  weight: true,
  cost: true,
  markupPercent: true,
  enabled: true,
});

export const rateImportSchema = z.object({
  csv: z.string().trim().min(1).max(200_000),
});

export const orgRateSchema = z.object({
  organizationId: z.uuid(),
  countryIso2: z.string().regex(/^[A-Z]{2}$/),
  mccmnc: mccmncSchema,
  price: z.string().trim().min(1).max(20),
});

export const clearRateSchema = z.object({
  countryIso2: z.string().regex(/^[A-Z]{2}$/),
  mccmnc: mccmncSchema,
  organizationId: z.uuid().nullable(),
});

export const balanceAdjustmentSchema = z.object({
  direction: z.enum(['credit', 'debit']),
  amount: z.string().trim().min(1).max(20),
  reason: z.string().trim().min(3).max(500),
});

export const organizationStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
});

export const spendCapSchema = z.object({
  dailySpendCap: z.string().trim().min(1).max(20).nullable(),
});

export const platformSpendCapSchema = z.object({
  defaultDailySpendCap: z.string().trim().min(1).max(20),
});

export const platformSettingsSchema = z
  .object({
    defaultDailySpendCap: z.string().trim().min(1).max(20).optional(),
    sharedSender: z
      .string()
      .trim()
      .refine((value) => value === '' || /^\d{8,15}$/.test(value), {
        message: 'Enter the shared sender as 8 to 15 digits, or leave it blank.',
      })
      .optional(),
  })
  .refine((value) => value.defaultDailySpendCap !== undefined || value.sharedSender !== undefined, {
    message: 'Send a spend cap or a shared sender.',
  });

export const addCountrySchema = z.object({
  countryIso2: z.string().regex(/^[A-Z]{2}$/),
  senderId: z.uuid().nullable(),
});

export const requestSenderSchema = z.object({
  type: z.enum(['ALPHANUMERIC', 'LONG_CODE', 'SHORT_CODE']),
  value: z.string().trim().min(1).max(15),
  useCase: z.string().trim().min(10).max(500),
  countries: z
    .array(z.string().regex(/^[A-Z]{2}$/))
    .min(1)
    .max(50),
});
