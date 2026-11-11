/** Cookie names shared by the API and the web app. */
export const SESSION_COOKIE = 'smsvio_session';
export const CSRF_COOKIE = 'smsvio_csrf';
export const ORGANIZATION_COOKIE = 'smsvio_org';

/** 30-day sliding session, as required by the spec. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;

/**
 * Once the remaining lifetime drops below this, the next request pushes expiry
 * back out to a full 30 days. That keeps active sessions alive without a write
 * on every request.
 */
export const SESSION_EXTEND_BELOW_MS = 29 * 24 * 60 * 60 * 1000;

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PHONE_CODE_TTL_MS = 10 * 60 * 1000;
export const TOTP_CHALLENGE_TTL_SECONDS = 5 * 60;

/** OWASP recommended minimum for argon2id. */
export const ARGON2ID_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const RATE_LIMITS = {
  signupIp: { limit: 20, windowMs: 60 * 60 * 1000 },
  signupEmail: { limit: 5, windowMs: 60 * 60 * 1000 },
  signinIp: { limit: 30, windowMs: 15 * 60 * 1000 },
  signinAccount: { limit: 20, windowMs: 15 * 60 * 1000 },
  forgotIp: { limit: 10, windowMs: 60 * 60 * 1000 },
  forgotEmail: { limit: 5, windowMs: 60 * 60 * 1000 },
  totpIp: { limit: 15, windowMs: 15 * 60 * 1000 },
  totpAccount: { limit: 10, windowMs: 15 * 60 * 1000 },
  phoneIp: { limit: 10, windowMs: 60 * 60 * 1000 },
} as const;

export const MEMBERSHIP_ROLES = ['OWNER', 'ADMIN', 'DEVELOPER', 'BILLING', 'VIEWER'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const INVITE_ROLES = ['ADMIN', 'DEVELOPER', 'BILLING', 'VIEWER'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export const ORGANIZATION_STATUSES = ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

/**
 * Local demo password shipped in `.env.example`. Production seeding refuses this value.
 * It is not a secret: the local stack is only reachable from the same machine.
 */
export const LOCAL_DEMO_PASSWORD = 'smsvio-demo-local';
