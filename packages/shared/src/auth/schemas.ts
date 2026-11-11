import { z } from 'zod';

import { INVITE_ROLES, MEMBERSHIP_ROLES, PAGE_SIZES, type PageSize } from './constants.js';
import { passwordProblem } from './passwords.js';
import { isE164, isValidTimeZone } from './phone.js';

const personName = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(80, 'Use 80 characters or fewer.')
  .regex(
    /^[\p{L}\p{M}\p{N} .'-]+$/u,
    'Use letters, numbers, spaces, apostrophes, periods, or hyphens.',
  );

const organizationName = z
  .string()
  .trim()
  .min(2, 'Enter an organization name.')
  .max(80, 'Use 80 characters or fewer.');

export const emailSchema = z
  .string()
  .trim()
  .max(254, 'Enter a shorter email address.')
  .pipe(z.email('Enter a valid email address.'))
  .transform((value) => value.toLowerCase());

export const newPasswordSchema = z.string().superRefine((value, ctx) => {
  const problem = passwordProblem(value);
  if (problem !== null) {
    ctx.addIssue({ code: 'custom', message: problem });
  }
});

/** Sign-in accepts any stored password. Length is capped so hashing cannot be abused. */
export const signInPasswordSchema = z
  .string()
  .min(1, 'Enter your password.')
  .max(200, 'That password is too long.');

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value));

function passwordsDifferFromEmail(
  value: { email: string; password: string },
  ctx: z.RefinementCtx,
): void {
  if (value.password.toLowerCase() === value.email) {
    ctx.addIssue({
      code: 'custom',
      path: ['password'],
      message: 'Password must not match the email address.',
    });
  }
}

export const signupSchema = z
  .object({
    name: personName,
    email: emailSchema,
    password: newPasswordSchema,
    organizationName,
  })
  .superRefine(passwordsDifferFromEmail);

export const signInSchema = z.object({
  email: emailSchema,
  password: signInPasswordSchema,
});

export const emailOnlySchema = z.object({
  email: emailSchema,
});

export const tokenSchema = z.object({
  token: z.string().trim().min(20).max(512),
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(20).max(512),
  password: newPasswordSchema,
});

export const totpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

export const totpChallengeSchema = z.object({
  challenge: z.string().trim().min(20).max(512),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

export const changePasswordSchema = z.object({
  currentPassword: signInPasswordSchema,
  password: newPasswordSchema,
});

export const setPasswordSchema = z.object({
  password: newPasswordSchema,
});

export const createOrganizationSchema = z.object({
  name: organizationName,
});

export const profileSchema = z.object({
  name: personName,
});

export const detailsSchema = z.object({
  timezone: z.string().refine(isValidTimeZone, 'Choose a valid time zone.'),
  contactPhone: z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : value))
    .refine(
      (value) => value === null || isE164(value),
      'Use international format, for example +14155552671.',
    ),
});

export const phoneStartSchema = z.object({
  phone: z.string().trim().refine(isE164, 'Use international format, for example +14155552671.'),
});

export const phoneConfirmSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

export const businessSettingsSchema = z
  .object({
    legalName: nullableText(160),
    taxIdType: nullableText(40),
    taxId: nullableText(40),
  })
  .superRefine((value, ctx) => {
    if ((value.taxIdType === null) !== (value.taxId === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['taxId'],
        message: 'Enter both the tax ID type and the tax ID, or leave both empty.',
      });
    }
  });

export const switchOrganizationSchema = z.object({
  organizationId: z.uuid(),
});

export const deleteOrganizationSchema = z.object({
  confirmName: z.string().trim().min(1).max(80),
});

export const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(INVITE_ROLES),
});

export const changeRoleSchema = z.object({
  role: z.enum(INVITE_ROLES),
});

export const acceptInviteSchema = z
  .object({
    token: z.string().trim().min(20).max(512),
    name: personName.optional(),
    password: newPasswordSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.password !== undefined && value.name === undefined) {
      ctx.addIssue({ code: 'custom', path: ['name'], message: 'Enter your name.' });
    }
    if (value.name !== undefined && value.password === undefined) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: 'Choose a password.' });
    }
  });

export const disableTotpSchema = z.object({
  currentPassword: signInPasswordSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

const pageSizeSchema = z.coerce
  .number()
  .int()
  .refine((value): value is PageSize => (PAGE_SIZES as readonly number[]).includes(value), {
    message: 'Page size must be 10, 25, 50, or 100.',
  });

export const memberListQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(''),
  role: z.enum(MEMBERSHIP_ROLES).optional(),
  status: z.enum(['ACTIVE', 'INVITED']).optional(),
  sort: z.enum(['name', 'email', 'role', 'lastSeenAt']).default('name'),
  direction: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: pageSizeSchema.default(10),
});

export const auditListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: pageSizeSchema.default(10),
});

export const idParamSchema = z.object({
  id: z.uuid(),
});
