import { z } from 'zod';

import { INVITE_ROLES, MEMBERSHIP_ROLES, ORGANIZATION_STATUSES } from './constants.js';

const roleSchema = z.enum(MEMBERSHIP_ROLES);
const inviteRoleSchema = z.enum(INVITE_ROLES);

export const sessionResponseSchema = z.object({
  status: z.literal('authenticated'),
  user: z.object({
    id: z.uuid(),
    email: z.string(),
    name: z.string(),
    timezone: z.string(),
    totpEnabled: z.boolean(),
    isPlatformAdmin: z.boolean(),
    accountPhoneE164: z.string().nullable(),
    accountPhoneVerifiedAt: z.iso.datetime().nullable(),
    contactPhone: z.string().nullable(),
    hasPassword: z.boolean(),
  }),
  session: z.object({ id: z.uuid() }),
  organization: z
    .object({
      id: z.uuid(),
      name: z.string(),
      legalName: z.string().nullable(),
      status: z.enum(ORGANIZATION_STATUSES),
      role: roleSchema,
      timezone: z.string(),
      taxIdType: z.string().nullable(),
      taxId: z.string().nullable(),
    })
    .nullable(),
  memberships: z.array(
    z.object({
      organizationId: z.uuid(),
      name: z.string(),
      role: roleSchema,
    }),
  ),
});

export const messageResponseSchema = z.object({
  status: z.literal('ok'),
  message: z.string(),
});

export const totpRequiredSchema = z.object({
  status: z.literal('totp_required'),
  challenge: z.string(),
});

export const totpSetupSchema = z.object({
  secret: z.string(),
  otpauthUrl: z.string(),
  qrDataUrl: z.string(),
});

export const invitePreviewSchema = z.object({
  email: z.string(),
  organizationName: z.string(),
  role: inviteRoleSchema,
  hasAccount: z.boolean(),
});

export const signInRequiredSchema = z.object({
  status: z.literal('sign_in_required'),
  email: z.string(),
});

export const directoryRowSchema = z.object({
  kind: z.enum(['member', 'invitation']),
  id: z.uuid(),
  name: z.string().nullable(),
  email: z.string(),
  role: roleSchema,
  status: z.enum(['ACTIVE', 'INVITED']),
  lastSeenAt: z.iso.datetime().nullable(),
});

export const pageSchema = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});

export const directoryResponseSchema = pageSchema.extend({
  items: z.array(directoryRowSchema),
});

export const auditEntrySchema = z.object({
  id: z.uuid(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  actorUserId: z.uuid().nullable(),
  ip: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const auditListSchema = pageSchema.extend({
  items: z.array(auditEntrySchema),
});

export const sessionListSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      ip: z.string().nullable(),
      userAgent: z.string().nullable(),
      createdAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
      current: z.boolean(),
    }),
  ),
});

export type SessionResponse = z.output<typeof sessionResponseSchema>;
export type DirectoryResponse = z.output<typeof directoryResponseSchema>;
export type AuditListResponse = z.output<typeof auditListSchema>;
export type SessionListResponse = z.output<typeof sessionListSchema>;
export type InvitePreview = z.output<typeof invitePreviewSchema>;
export type TotpSetupResponse = z.output<typeof totpSetupSchema>;
