import { describe, expect, it } from 'vitest';

import { LOCAL_DEMO_PASSWORD, RATE_LIMITS } from './constants.js';
import { isCommonPassword, passwordProblem } from './passwords.js';
import { safeNextPath } from './paths.js';
import { isE164, isValidTimeZone, maskPhone } from './phone.js';
import {
  auditListSchema,
  directoryResponseSchema,
  invitePreviewSchema,
  messageResponseSchema,
  sessionListSchema,
  sessionResponseSchema,
  signInRequiredSchema,
  totpRequiredSchema,
  totpSetupSchema,
} from './responses.js';
import { roleAllows } from './roles.js';
import {
  acceptInviteSchema,
  businessSettingsSchema,
  detailsSchema,
  inviteSchema,
  memberListQuerySchema,
  newPasswordSchema,
  signupSchema,
} from './schemas.js';

describe('password policy', () => {
  it('accepts the documented local demo password', () => {
    expect(passwordProblem(LOCAL_DEMO_PASSWORD)).toBeNull();
  });

  it('rejects short, huge, and common passwords', () => {
    expect(passwordProblem('short')).toMatch(/at least 10/);
    expect(passwordProblem('x'.repeat(201))).toMatch(/at most 200/);
    expect(passwordProblem('password123')).toMatch(/less common/);
    expect(isCommonPassword('PASSWORD')).toBe(true);
    expect(isCommonPassword('welcome!!!')).toBe(true);
    expect(isCommonPassword('welcome!!')).toBe(true);
    expect(isCommonPassword('correct horse battery')).toBe(false);
  });

  it('ignores a trailing-digit root that is too short to be a word', () => {
    expect(isCommonPassword('ab1234567890')).toBe(false);
    expect(isCommonPassword('12345678901')).toBe(false);
  });
});

describe('roles', () => {
  it('matches the capability table', () => {
    expect(roleAllows('VIEWER', 'view')).toBe(true);
    expect(roleAllows('VIEWER', 'manage')).toBe(false);
    expect(roleAllows('BILLING', 'billing')).toBe(true);
    expect(roleAllows('BILLING', 'messaging')).toBe(false);
    expect(roleAllows('DEVELOPER', 'developer')).toBe(true);
    expect(roleAllows('DEVELOPER', 'compliance')).toBe(false);
    expect(roleAllows('ADMIN', 'manage')).toBe(true);
    expect(roleAllows('ADMIN', 'own')).toBe(false);
    expect(roleAllows('OWNER', 'own')).toBe(true);
  });
});

describe('safeNextPath', () => {
  it('keeps same-origin relative paths', () => {
    expect(safeNextPath('/dashboard')).toBe('/dashboard');
    expect(safeNextPath('/dashboard/users?tab=1#row')).toBe('/dashboard/users?tab=1#row');
    expect(safeNextPath('  /admin  ')).toBe('/admin');
  });

  it('rejects open redirects and auth-page loops', () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath('')).toBeNull();
    expect(safeNextPath('https://evil.example')).toBeNull();
    expect(safeNextPath('//evil.example')).toBeNull();
    expect(safeNextPath('/\\evil')).toBeNull();
    expect(safeNextPath('/dashboard\n')).toBeNull();
    expect(safeNextPath('/signin')).toBeNull();
    expect(safeNextPath('/reset-password?token=abc')).toBeNull();
    expect(safeNextPath('/signin?next=/dashboard')).toBeNull();
  });
});

describe('phone and time zones', () => {
  it('validates E.164 and masks the middle digits', () => {
    expect(isE164('+14155552671')).toBe(true);
    expect(isE164('14155552671')).toBe(false);
    expect(isE164('+123')).toBe(false);
    expect(maskPhone('+14155552671')).toBe('+141••••71');
    expect(maskPhone('14155552671')).toBe('141••••71');
    expect(maskPhone('+123')).toBe('••••');
  });

  it('accepts IANA time zones only', () => {
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('x'.repeat(101))).toBe(false);
  });
});

describe('auth schemas', () => {
  const signup = {
    name: 'Ada Lovelace',
    email: 'Ada@Example.com',
    password: LOCAL_DEMO_PASSWORD,
    organizationName: 'Analytical Engines',
  };

  it('normalises signup email and rejects weak or matching passwords', () => {
    expect(signupSchema.parse(signup)).toMatchObject({ email: 'ada@example.com' });
    expect(signupSchema.safeParse({ ...signup, email: 'not-an-email' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...signup, password: 'password123' }).success).toBe(false);
    expect(
      signupSchema.safeParse({ ...signup, email: 'ada@example.com', password: 'ada@example.com' })
        .success,
    ).toBe(false);
    expect(newPasswordSchema.safeParse('short').success).toBe(false);
  });

  it('requires both tax fields and a real phone', () => {
    expect(businessSettingsSchema.parse({ legalName: '', taxIdType: '', taxId: '' })).toEqual({
      legalName: null,
      taxIdType: null,
      taxId: null,
    });
    expect(
      businessSettingsSchema.safeParse({ legalName: 'A', taxIdType: 'EIN', taxId: '' }).success,
    ).toBe(false);
    expect(detailsSchema.parse({ timezone: 'UTC', contactPhone: '' }).contactPhone).toBeNull();
    expect(detailsSchema.safeParse({ timezone: 'UTC', contactPhone: '555' }).success).toBe(false);
    expect(detailsSchema.safeParse({ timezone: 'Mars/Olympus', contactPhone: '' }).success).toBe(
      false,
    );
  });

  it('limits invitations to non-owner roles and parses list queries', () => {
    expect(inviteSchema.parse({ email: 'Dev@Example.com', role: 'DEVELOPER' }).email).toBe(
      'dev@example.com',
    );
    expect(inviteSchema.safeParse({ email: 'dev@example.com', role: 'OWNER' }).success).toBe(false);
    expect(memberListQuerySchema.parse({})).toMatchObject({
      q: '',
      sort: 'name',
      direction: 'asc',
      page: 1,
      pageSize: 10,
    });
    expect(memberListQuerySchema.safeParse({ pageSize: '15' }).success).toBe(false);
    expect(acceptInviteSchema.safeParse({ token: 'x'.repeat(32), name: 'Ada' }).success).toBe(
      false,
    );
    expect(
      acceptInviteSchema.safeParse({ token: 'x'.repeat(32), password: LOCAL_DEMO_PASSWORD })
        .success,
    ).toBe(false);
    expect(
      acceptInviteSchema.safeParse({
        token: 'x'.repeat(32),
        name: 'Ada',
        password: LOCAL_DEMO_PASSWORD,
      }).success,
    ).toBe(true);
  });
});

describe('response schemas', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const at = '2026-11-11T00:00:00.000Z';

  it('accepts the account payloads the api returns', () => {
    expect(
      sessionResponseSchema.parse({
        status: 'authenticated',
        user: {
          id,
          email: 'ada@example.com',
          name: 'Ada',
          timezone: 'UTC',
          totpEnabled: false,
          isPlatformAdmin: false,
          accountPhoneE164: null,
          accountPhoneVerifiedAt: null,
          contactPhone: null,
          hasPassword: false,
        },
        session: { id },
        organization: null,
        memberships: [],
      }).status,
    ).toBe('authenticated');
    expect(messageResponseSchema.parse({ status: 'ok', message: 'Sent.' }).message).toBe('Sent.');
    expect(totpRequiredSchema.parse({ status: 'totp_required', challenge: 'abc' }).challenge).toBe(
      'abc',
    );
    expect(totpSetupSchema.parse({ secret: 's', otpauthUrl: 'u', qrDataUrl: 'd' }).secret).toBe(
      's',
    );
    expect(
      invitePreviewSchema.parse({
        email: 'ada@example.com',
        organizationName: 'Ada Org',
        role: 'VIEWER',
        hasAccount: false,
      }).role,
    ).toBe('VIEWER');
    expect(
      signInRequiredSchema.parse({ status: 'sign_in_required', email: 'ada@example.com' }).email,
    ).toBe('ada@example.com');
    expect(
      directoryResponseSchema.parse({
        page: 1,
        pageSize: 10,
        total: 1,
        items: [
          {
            kind: 'member',
            id,
            name: 'Ada',
            email: 'ada@example.com',
            role: 'OWNER',
            status: 'ACTIVE',
            lastSeenAt: at,
          },
        ],
      }).total,
    ).toBe(1);
    expect(
      auditListSchema.parse({
        page: 1,
        pageSize: 10,
        total: 1,
        items: [
          {
            id,
            action: 'organization.deleted',
            targetType: 'organization',
            targetId: null,
            actorUserId: null,
            ip: null,
            createdAt: at,
          },
        ],
      }).total,
    ).toBe(1);
    expect(
      sessionListSchema.parse({
        items: [
          {
            id,
            ip: null,
            userAgent: null,
            createdAt: at,
            expiresAt: at,
            current: true,
          },
        ],
      }).items,
    ).toHaveLength(1);
  });
});

describe('rate limit table', () => {
  it('has a positive limit and window for every bucket', () => {
    for (const bucket of Object.values(RATE_LIMITS)) {
      expect(bucket.limit).toBeGreaterThan(0);
      expect(bucket.windowMs).toBeGreaterThan(0);
    }
  });
});
