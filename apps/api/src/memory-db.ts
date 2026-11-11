import { randomUUID } from 'node:crypto';

import { Prisma } from '@smsvio/db';

interface UserRow {
  id: string;
  email: string;
  passwordHash: string | null;
  googleSub: string | null;
  name: string;
  emailVerifiedAt: Date | null;
  totpSecretEnc: string | null;
  totpPendingSecretEnc: string | null;
  totpEnabledAt: Date | null;
  totpLastStep: number | null;
  isPlatformAdmin: boolean;
  lastSeenAt: Date | null;
  accountPhoneE164: string | null;
  accountPhoneVerifiedAt: Date | null;
  contactPhone: string | null;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

interface SessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  ip: string | null;
  userAgent: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface OrganizationRow {
  id: string;
  name: string;
  legalName: string | null;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED';
  timezone: string;
  smartEncoding: boolean;
  dailySpendCapMicros: bigint | null;
  messageRetentionDays: number;
  taxIdType: string | null;
  taxId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MembershipRow {
  id: string;
  userId: string;
  organizationId: string;
  role: 'OWNER' | 'ADMIN' | 'DEVELOPER' | 'BILLING' | 'VIEWER';
  status: 'ACTIVE';
  createdAt: Date;
  updatedAt: Date;
}

interface InvitationRow {
  id: string;
  organizationId: string;
  email: string;
  role: MembershipRow['role'];
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  invitedById: string;
  createdAt: Date;
  updatedAt: Date;
}

interface AuthTokenRow {
  id: string;
  userId: string;
  purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'PHONE_VERIFICATION';
  tokenHash: string;
  subject: string | null;
  attempts: number;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

interface ContactRow {
  id: string;
  organizationId: string;
  phoneE164: string;
  countryCode: string;
  name: string | null;
  attributes: unknown;
  optedOut: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface TemplateRow {
  id: string;
  organizationId: string;
  createdById: string | null;
  name: string;
  category: 'AUTHENTICATION' | 'UTILITY' | 'MARKETING';
  language: string;
  body: string;
  variables: unknown;
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MessageRow {
  id: string;
  organizationId: string;
  templateId: string | null;
  to: string;
  fromSender: string | null;
  body: string;
  direction: 'OUTBOUND' | 'INBOUND';
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

interface CountryRow {
  iso2: string;
  name: string;
  dialCode: string;
  alphaSenderAllowed: boolean;
  registrationRequired: boolean;
  notes: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface AuditRow {
  id: string;
  organizationId: string | null;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  meta: unknown;
  ip: string | null;
  createdAt: Date;
}

type Where = Record<string, unknown>;

function matches(row: object, where: Where): boolean {
  for (const [key, expected] of Object.entries(where)) {
    if (key === 'OR' && Array.isArray(expected)) {
      if (!expected.some((item) => isWhere(item) && matches(row, item))) {
        return false;
      }
      continue;
    }
    const value = (row as Record<string, unknown>)[key];
    if (expected !== null && typeof expected === 'object' && !(expected instanceof Date)) {
      if (!matchFilter(value, expected as Record<string, unknown>)) {
        return false;
      }
      continue;
    }
    if (value !== expected) {
      return false;
    }
  }
  return true;
}

function isWhere(value: unknown): value is Where {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchFilter(value: unknown, filter: Record<string, unknown>): boolean {
  if ('gt' in filter) {
    return (
      value instanceof Date && filter.gt instanceof Date && value.getTime() > filter.gt.getTime()
    );
  }
  if ('gte' in filter) {
    return (
      value instanceof Date && filter.gte instanceof Date && value.getTime() >= filter.gte.getTime()
    );
  }
  if ('not' in filter) {
    return value !== filter.not;
  }
  if ('in' in filter && Array.isArray(filter.in)) {
    return filter.in.includes(value);
  }
  if ('contains' in filter && typeof filter.contains === 'string') {
    return typeof value === 'string' && contains(value, filter.contains);
  }
  return false;
}

function pageOf<T>(rows: readonly T[], skip?: number, take?: number): T[] {
  const start = skip ?? 0;
  return rows.slice(start, start + (take ?? rows.length));
}

function byOrder<T extends object>(
  rows: readonly T[],
  orderBy?: Record<string, 'asc' | 'desc'>,
): T[] {
  const entry = orderBy === undefined ? undefined : Object.entries(orderBy)[0];
  if (entry === undefined) {
    return [...rows];
  }
  const [key, direction] = entry;
  const factor = direction === 'desc' ? -1 : 1;
  return [...rows].sort((left, right) => {
    const a = (left as Record<string, unknown>)[key];
    const b = (right as Record<string, unknown>)[key];
    if (a instanceof Date && b instanceof Date) {
      return (a.getTime() - b.getTime()) * factor;
    }
    if (typeof a === 'string' && typeof b === 'string') {
      return a.localeCompare(b) * factor;
    }
    if (a === null || a === undefined) {
      return factor;
    }
    if (b === null || b === undefined) {
      return -factor;
    }
    return 0;
  });
}

function projected<T extends object>(row: T, select?: Record<string, boolean>): T {
  if (select === undefined) {
    return row;
  }
  const copy: Record<string, unknown> = {};
  for (const [key, enabled] of Object.entries(select)) {
    if (enabled) {
      copy[key] = (row as Record<string, unknown>)[key];
    }
  }
  return copy as T;
}

function contains(value: string, fragment: string): boolean {
  return value.toLowerCase().includes(fragment.toLowerCase());
}

function stamp(): { id: string; createdAt: Date; updatedAt: Date } {
  const now = new Date();
  return { id: randomUUID(), createdAt: now, updatedAt: now };
}

function uniqueConflict(): never {
  throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

/** In-memory stand-in for the Prisma calls the accounts module makes. */
export function createMemoryDb() {
  const users = new Map<string, UserRow>();
  const sessions = new Map<string, SessionRow>();
  const organizations = new Map<string, OrganizationRow>();
  const memberships = new Map<string, MembershipRow>();
  const invitations = new Map<string, InvitationRow>();
  const tokens = new Map<string, AuthTokenRow>();
  const audits: AuditRow[] = [];
  const contacts = new Map<string, ContactRow>();
  const templates = new Map<string, TemplateRow>();
  const messages = new Map<string, MessageRow>();
  const countries = new Map<string, CountryRow>();
  const messaging = createMessagingMemory();

  function userByEmail(email: string): UserRow | null {
    return [...users.values()].find((user) => user.email === email) ?? null;
  }

  function withMemberships(user: UserRow) {
    const rows = [...memberships.values()]
      .filter((membership) => membership.userId === user.id)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((membership) => ({
        ...membership,
        organization: organizations.get(membership.organizationId),
      }));
    return { ...user, memberships: rows };
  }

  const db = {
    $queryRaw: () => Promise.resolve([{ '?column?': 1 }]),
    $disconnect: () => Promise.resolve(),
    $transaction: async (input: ((client: object) => Promise<unknown>) | Promise<unknown>[]) => {
      if (typeof input === 'function') {
        return input(db);
      }
      return Promise.all(input);
    },
    user: {
      findUnique: ({ where, include }: { where: Where; include?: unknown }) => {
        const user =
          typeof where.id === 'string'
            ? (users.get(where.id) ?? null)
            : typeof where.googleSub === 'string'
              ? ([...users.values()].find((row) => row.googleSub === where.googleSub) ?? null)
              : userByEmail(String(where.email));
        if (user === null) {
          return Promise.resolve(null);
        }
        return Promise.resolve(include === undefined ? user : withMemberships(user));
      },
      create: ({
        data,
      }: {
        data: Partial<UserRow> & Pick<UserRow, 'email' | 'name' | 'passwordHash'>;
      }) => {
        if (userByEmail(data.email) !== null) {
          uniqueConflict();
        }
        const row: UserRow = {
          googleSub: null,
          emailVerifiedAt: null,
          totpSecretEnc: null,
          totpPendingSecretEnc: null,
          totpEnabledAt: null,
          totpLastStep: null,
          isPlatformAdmin: false,
          lastSeenAt: null,
          accountPhoneE164: null,
          accountPhoneVerifiedAt: null,
          contactPhone: null,
          timezone: 'UTC',
          ...stamp(),
          ...data,
        };
        users.set(row.id, row);
        return Promise.resolve(row);
      },
      update: ({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
        const row = users.get(where.id);
        if (row === undefined) {
          throw new Error(`missing user ${where.id}`);
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve(row);
      },
    },
    session: {
      findUnique: ({ where }: { where: { tokenHash: string } }) =>
        Promise.resolve(
          [...sessions.values()].find((session) => session.tokenHash === where.tokenHash) ?? null,
        ),
      findMany: ({ where, orderBy }: { where: Where; orderBy?: { createdAt: 'desc' } }) => {
        const rows = [...sessions.values()].filter((session) => matches(session, where));
        if (orderBy?.createdAt === 'desc') {
          rows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
        }
        return Promise.resolve(rows);
      },
      create: ({
        data,
      }: {
        data: Omit<SessionRow, 'id' | 'createdAt' | 'updatedAt' | 'revokedAt'> & {
          revokedAt?: Date | null;
        };
      }) => {
        const row: SessionRow = { revokedAt: null, ...stamp(), ...data };
        sessions.set(row.id, row);
        return Promise.resolve(row);
      },
      update: ({ where, data }: { where: { id: string }; data: Partial<SessionRow> }) => {
        const row = sessions.get(where.id);
        if (row === undefined) {
          throw new Error(`missing session ${where.id}`);
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve(row);
      },
      updateMany: ({ where, data }: { where: Where; data: Partial<SessionRow> }) => {
        const rows = [...sessions.values()].filter((session) => matches(session, where));
        for (const row of rows) {
          Object.assign(row, data, { updatedAt: new Date() });
        }
        return Promise.resolve({ count: rows.length });
      },
    },
    organization: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(organizations.get(where.id) ?? null),
      create: ({ data }: { data: Partial<OrganizationRow> & Pick<OrganizationRow, 'name'> }) => {
        const row: OrganizationRow = {
          legalName: null,
          status: 'PENDING_VERIFICATION',
          timezone: 'UTC',
          smartEncoding: true,
          dailySpendCapMicros: null,
          messageRetentionDays: 365,
          taxIdType: null,
          taxId: null,
          ...stamp(),
          ...data,
        };
        organizations.set(row.id, row);
        return Promise.resolve(row);
      },
      update: ({ where, data }: { where: { id: string }; data: Partial<OrganizationRow> }) => {
        const row = organizations.get(where.id);
        if (row === undefined) {
          throw new Error(`missing organization ${where.id}`);
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve(row);
      },
      delete: ({ where }: { where: { id: string } }) => {
        const row = organizations.get(where.id);
        if (row === undefined) {
          throw new Error(`missing organization ${where.id}`);
        }
        organizations.delete(where.id);
        for (const [id, membership] of memberships) {
          if (membership.organizationId === where.id) {
            memberships.delete(id);
          }
        }
        for (const [id, invitation] of invitations) {
          if (invitation.organizationId === where.id) {
            invitations.delete(id);
          }
        }
        for (let index = audits.length - 1; index >= 0; index -= 1) {
          if (audits[index]?.organizationId === where.id) {
            audits.splice(index, 1);
          }
        }
        messaging.clearOrganization(where.id);
        return Promise.resolve(row);
      },
      count: ({ where }: { where?: Where }) =>
        Promise.resolve(
          [...organizations.values()].filter((row) => matches(row, where ?? {})).length,
        ),
      findMany: ({
        where,
        orderBy,
        skip,
        take,
      }: {
        where?: Where;
        orderBy?: Record<string, 'asc' | 'desc'>;
        skip?: number;
        take?: number;
      } = {}) =>
        Promise.resolve(
          pageOf(
            byOrder(
              [...organizations.values()].filter((row) => matches(row, where ?? {})),
              orderBy,
            ),
            skip,
            take,
          ),
        ),
    },
    membership: {
      count: ({ where }: { where: Where }) =>
        Promise.resolve([...memberships.values()].filter((row) => matches(row, where)).length),
      findUnique: ({
        where,
      }: {
        where: { userId_organizationId: { userId: string; organizationId: string } };
      }) =>
        Promise.resolve(
          [...memberships.values()].find(
            (membership) =>
              membership.userId === where.userId_organizationId.userId &&
              membership.organizationId === where.userId_organizationId.organizationId,
          ) ?? null,
        ),
      findFirst: ({ where }: { where: Where & { user?: { email: string } } }) => {
        const row =
          [...memberships.values()].find((membership) => {
            if (!matches(membership, { ...where, user: undefined })) {
              return false;
            }
            if (
              where.user !== undefined &&
              users.get(membership.userId)?.email !== where.user.email
            ) {
              return false;
            }
            return true;
          }) ?? null;
        return Promise.resolve(row === null ? null : { ...row, user: users.get(row.userId) });
      },
      findMany: ({
        where,
      }: {
        where: Where & {
          user?: { OR: { email?: { contains: string }; name?: { contains: string } }[] };
        };
      }) => {
        const rows = [...memberships.values()].filter((membership) => {
          const plain = { ...where };
          delete plain.user;
          if (!matches(membership, plain)) {
            return false;
          }
          const user = users.get(membership.userId);
          if (user === undefined) {
            return false;
          }
          const or = where.user?.OR;
          if (or !== undefined) {
            const hit = or.some((clause) => {
              if (clause.email !== undefined) {
                return contains(user.email, clause.email.contains);
              }
              if (clause.name !== undefined) {
                return contains(user.name, clause.name.contains);
              }
              return false;
            });
            if (!hit) {
              return false;
            }
          }
          return true;
        });
        return Promise.resolve(rows.map((row) => ({ ...row, user: users.get(row.userId) })));
      },
      create: ({
        data,
      }: {
        data: Pick<MembershipRow, 'userId' | 'organizationId' | 'role'> & Partial<MembershipRow>;
      }) => {
        const duplicate = [...memberships.values()].some(
          (membership) =>
            membership.userId === data.userId && membership.organizationId === data.organizationId,
        );
        if (duplicate) {
          uniqueConflict();
        }
        const row: MembershipRow = { status: 'ACTIVE', ...stamp(), ...data };
        memberships.set(row.id, row);
        return Promise.resolve(row);
      },
      update: ({ where, data }: { where: { id: string }; data: Partial<MembershipRow> }) => {
        const row = memberships.get(where.id);
        if (row === undefined) {
          throw new Error(`missing membership ${where.id}`);
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve(row);
      },
      delete: ({ where }: { where: { id: string } }) => {
        const row = memberships.get(where.id);
        if (row === undefined) {
          throw new Error(`missing membership ${where.id}`);
        }
        memberships.delete(where.id);
        return Promise.resolve(row);
      },
    },
    invitation: {
      findUnique: ({
        where,
        include,
      }: {
        where: { tokenHash: string };
        include?: { organization: boolean };
      }) => {
        const row =
          [...invitations.values()].find(
            (invitation) => invitation.tokenHash === where.tokenHash,
          ) ?? null;
        if (row === null || include === undefined) {
          return Promise.resolve(row);
        }
        return Promise.resolve({ ...row, organization: organizations.get(row.organizationId) });
      },
      findFirst: ({ where, include }: { where: Where; include?: { organization: boolean } }) => {
        const row =
          [...invitations.values()].find((invitation) => matches(invitation, where)) ?? null;
        if (row === null || include === undefined) {
          return Promise.resolve(row);
        }
        return Promise.resolve({ ...row, organization: organizations.get(row.organizationId) });
      },
      findMany: ({ where }: { where: Where & { email?: { contains: string } } }) => {
        const rows = [...invitations.values()].filter((invitation) => {
          const plain = { ...where };
          delete plain.email;
          if (!matches(invitation, plain)) {
            return false;
          }
          const email = where.email;
          return email === undefined || contains(invitation.email, email.contains);
        });
        return Promise.resolve(rows);
      },
      create: ({
        data,
      }: {
        data: Omit<InvitationRow, 'id' | 'createdAt' | 'updatedAt' | 'acceptedAt' | 'revokedAt'> &
          Partial<InvitationRow>;
      }) => {
        const row: InvitationRow = { acceptedAt: null, revokedAt: null, ...stamp(), ...data };
        invitations.set(row.id, row);
        return Promise.resolve(row);
      },
      update: ({ where, data }: { where: { id: string }; data: Partial<InvitationRow> }) => {
        const row = invitations.get(where.id);
        if (row === undefined) {
          throw new Error(`missing invitation ${where.id}`);
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve(row);
      },
    },
    authToken: {
      findUnique: ({
        where,
        include,
      }: {
        where: { tokenHash: string };
        include?: { user: boolean };
      }) => {
        const row =
          [...tokens.values()].find((token) => token.tokenHash === where.tokenHash) ?? null;
        if (row === null || include === undefined) {
          return Promise.resolve(row);
        }
        return Promise.resolve({ ...row, user: users.get(row.userId) });
      },
      findFirst: ({ where, orderBy }: { where: Where; orderBy?: { createdAt: 'desc' } }) => {
        const rows = [...tokens.values()].filter((token) => matches(token, where));
        if (orderBy?.createdAt === 'desc') {
          rows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
        }
        return Promise.resolve(rows[0] ?? null);
      },
      create: ({
        data,
      }: {
        data: Omit<AuthTokenRow, 'id' | 'createdAt' | 'attempts' | 'usedAt' | 'subject'> &
          Partial<AuthTokenRow>;
      }) => {
        const row: AuthTokenRow = {
          attempts: 0,
          usedAt: null,
          subject: null,
          id: randomUUID(),
          createdAt: new Date(),
          ...data,
        };
        tokens.set(row.id, row);
        return Promise.resolve(row);
      },
      update: ({ where, data }: { where: { id: string }; data: Partial<AuthTokenRow> }) => {
        const row = tokens.get(where.id);
        if (row === undefined) {
          throw new Error(`missing token ${where.id}`);
        }
        Object.assign(row, data);
        return Promise.resolve(row);
      },
      updateMany: ({ where, data }: { where: Where; data: Partial<AuthTokenRow> }) => {
        const rows = [...tokens.values()].filter((token) => matches(token, where));
        for (const row of rows) {
          Object.assign(row, data);
        }
        return Promise.resolve({ count: rows.length });
      },
    },
    contact: {
      count: ({ where }: { where?: Where }) =>
        Promise.resolve([...contacts.values()].filter((row) => matches(row, where ?? {})).length),
      findMany: ({
        where,
        orderBy,
        skip,
        take,
        select,
      }: {
        where?: Where;
        orderBy?: Record<string, 'asc' | 'desc'>;
        skip?: number;
        take?: number;
        select?: Record<string, boolean>;
      }) =>
        Promise.resolve(
          pageOf(
            byOrder(
              [...contacts.values()].filter((row) => matches(row, where ?? {})),
              orderBy,
            ),
            skip,
            take,
          ).map((row) => projected(row, select)),
        ),
      findFirst: ({ where }: { where: Where }) =>
        Promise.resolve([...contacts.values()].find((row) => matches(row, where)) ?? null),
      create: ({
        data,
      }: {
        data: Omit<ContactRow, 'id' | 'createdAt' | 'updatedAt' | 'optedOut' | 'attributes'> &
          Partial<ContactRow>;
      }) => {
        const duplicate = [...contacts.values()].find(
          (row) => row.organizationId === data.organizationId && row.phoneE164 === data.phoneE164,
        );
        if (duplicate !== undefined) {
          uniqueConflict();
        }
        const row: ContactRow = {
          attributes: {},
          optedOut: false,
          ...stamp(),
          ...data,
        };
        contacts.set(row.id, row);
        return Promise.resolve(row);
      },
      delete: ({ where }: { where: { id: string } }) => {
        const row = contacts.get(where.id);
        if (row === undefined) {
          throw new Error(`missing contact ${where.id}`);
        }
        contacts.delete(where.id);
        return Promise.resolve(row);
      },
    },
    template: {
      count: ({ where }: { where?: Where }) =>
        Promise.resolve([...templates.values()].filter((row) => matches(row, where ?? {})).length),
      findMany: ({
        where,
        orderBy,
        skip,
        take,
      }: {
        where?: Where;
        orderBy?: Record<string, 'asc' | 'desc'>;
        skip?: number;
        take?: number;
      }) =>
        Promise.resolve(
          pageOf(
            byOrder(
              [...templates.values()].filter((row) => matches(row, where ?? {})),
              orderBy,
            ),
            skip,
            take,
          ),
        ),
      findFirst: ({ where }: { where: Where }) =>
        Promise.resolve([...templates.values()].find((row) => matches(row, where)) ?? null),
      create: ({
        data,
      }: {
        data: Omit<TemplateRow, 'id' | 'createdAt' | 'updatedAt' | 'rejectionReason' | 'status'> &
          Partial<TemplateRow>;
      }) => {
        const row: TemplateRow = {
          status: 'DRAFT',
          rejectionReason: null,
          ...stamp(),
          ...data,
        };
        templates.set(row.id, row);
        return Promise.resolve(row);
      },
      update: ({ where, data }: { where: { id: string }; data: Partial<TemplateRow> }) => {
        const row = templates.get(where.id);
        if (row === undefined) {
          throw new Error(`missing template ${where.id}`);
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve(row);
      },
      delete: ({ where }: { where: { id: string } }) => {
        const row = templates.get(where.id);
        if (row === undefined) {
          throw new Error(`missing template ${where.id}`);
        }
        templates.delete(where.id);
        return Promise.resolve(row);
      },
    },
    message: {
      findMany: ({
        where,
        orderBy,
        take,
        select,
      }: {
        where?: Where;
        orderBy?: Record<string, 'asc' | 'desc'>;
        take?: number;
        select?: Record<string, boolean>;
      }) =>
        Promise.resolve(
          pageOf(
            byOrder(
              [...messages.values()].filter((row) => matches(row, where ?? {})),
              orderBy,
            ),
            0,
            take,
          ).map((row) => projected(row, select)),
        ),
      create: ({
        data,
      }: {
        data: Omit<MessageRow, 'id' | 'createdAt' | 'updatedAt' | 'templateId' | 'fromSender'> &
          Partial<MessageRow>;
      }) => {
        const row: MessageRow = {
          templateId: null,
          fromSender: null,
          ...stamp(),
          ...data,
        };
        messages.set(row.id, row);
        return Promise.resolve(row);
      },
    },
    country: {
      findUnique: ({ where }: { where: { iso2: string } }) =>
        Promise.resolve(countries.get(where.iso2) ?? null),
      findMany: ({ where, orderBy }: { where?: Where; orderBy?: Record<string, 'asc' | 'desc'> }) =>
        Promise.resolve(
          byOrder(
            [...countries.values()].filter((row) => matches(row, where ?? {})),
            orderBy,
          ),
        ),
      create: ({
        data,
      }: {
        data: Omit<CountryRow, 'createdAt' | 'updatedAt' | 'enabled' | 'notes'> &
          Partial<CountryRow>;
      }) => {
        if (countries.has(data.iso2)) {
          uniqueConflict();
        }
        const now = new Date();
        const row: CountryRow = {
          notes: null,
          enabled: true,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        countries.set(row.iso2, row);
        return Promise.resolve(row);
      },
    },
    auditLog: {
      create: ({
        data,
      }: {
        data: Omit<AuditRow, 'id' | 'createdAt' | 'targetId' | 'meta'> & Partial<AuditRow>;
      }) => {
        const row: AuditRow = {
          id: randomUUID(),
          createdAt: new Date(),
          targetId: null,
          meta: null,
          ...data,
        };
        audits.push(row);
        return Promise.resolve(row);
      },
      count: ({ where }: { where: Where }) =>
        Promise.resolve(audits.filter((row) => matches(row, where)).length),
      findMany: ({
        where,
        orderBy,
        skip,
        take,
      }: {
        where: Where;
        orderBy?: { createdAt: 'desc' };
        skip?: number;
        take?: number;
      }) => {
        const rows = audits.filter((row) => matches(row, where));
        if (orderBy?.createdAt === 'desc') {
          rows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
        }
        return Promise.resolve(rows.slice(skip ?? 0, (skip ?? 0) + (take ?? rows.length)));
      },
    },
    ...messaging.delegates,
  };

  return db;
}

function listed<T extends object>(
  rows: Iterable<T>,
  args?: {
    where?: Where;
    orderBy?: Record<string, 'asc' | 'desc'>;
    skip?: number;
    take?: number;
  },
): T[] {
  const query = args ?? {};
  return pageOf(
    byOrder(
      [...rows].filter((row) => matches(row, query.where ?? {})),
      query.orderBy,
    ),
    query.skip,
    query.take,
  );
}

function removeWhere<T extends object>(
  rows: Map<string, T>,
  where: Where,
  key: (row: T) => string,
): { count: number } {
  let count = 0;
  for (const row of [...rows.values()]) {
    if (matches(row, where)) {
      rows.delete(key(row));
      count += 1;
    }
  }
  return { count };
}

function nextAmount(current: bigint, change: unknown): bigint {
  if (typeof change === 'bigint') {
    return change;
  }
  if (typeof change === 'object' && change !== null) {
    const record = change as { increment?: bigint; decrement?: bigint };
    if (typeof record.increment === 'bigint') {
      return current + record.increment;
    }
    if (typeof record.decrement === 'bigint') {
      return current - record.decrement;
    }
  }
  return current;
}

function amountAllows(value: bigint, expected: unknown): boolean {
  if (expected === undefined) {
    return true;
  }
  if (typeof expected === 'bigint') {
    return value === expected;
  }
  if (typeof expected === 'object' && expected !== null && 'gte' in expected) {
    const bound = expected.gte;
    return typeof bound === 'bigint' && value >= bound;
  }
  return false;
}

function createMessagingMemory() {
  interface Timed {
    createdAt: Date;
    updatedAt: Date;
  }
  interface ProviderRow extends Timed {
    id: string;
    code: string;
    type: 'MOCK' | 'SMPP' | 'HTTP';
    configEnc: string | null;
    status: 'ACTIVE' | 'DISABLED';
    maxTps: number;
    callbackSecretHash: string | null;
    markupPercent: number;
  }
  interface RouteRow extends Timed {
    id: string;
    countryIso2: string;
    mccmnc: string | null;
    providerId: string;
    priority: number;
    weight: number;
    costMicros: bigint;
    markupPercent: number | null;
    enabled: boolean;
  }
  interface RateRow extends Timed {
    id: string;
    countryIso2: string;
    mccmnc: string | null;
    priceMicros: bigint;
    effectiveFrom: Date;
  }
  interface OrgRateRow extends RateRow {
    organizationId: string;
  }
  interface SenderRow extends Timed {
    id: string;
    organizationId: string;
    type: 'ALPHANUMERIC' | 'LONG_CODE' | 'SHORT_CODE';
    value: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    useCase: string;
    reviewNote: string | null;
    intendedCountries: string[];
  }
  interface OrgCountryRow extends Timed {
    id: string;
    organizationId: string;
    countryIso2: string;
    senderIdId: string | null;
    registrationComplete: boolean;
  }
  interface BalanceRow extends Timed {
    organizationId: string;
    availableMicros: bigint;
    heldMicros: bigint;
  }
  interface LedgerRow extends Timed {
    id: string;
    organizationId: string;
    type: 'TOPUP' | 'HOLD' | 'CHARGE' | 'RELEASE' | 'REFUND' | 'ADJUSTMENT';
    amountMicros: bigint;
    balanceAfterMicros: bigint;
    refType: string | null;
    refId: string | null;
    note: string | null;
  }
  interface SettingRow extends Timed {
    id: string;
    defaultDailySpendCapMicros: bigint;
  }

  const providers = new Map<string, ProviderRow>();
  const routes = new Map<string, RouteRow>();
  const rates = new Map<string, RateRow>();
  const orgRates = new Map<string, OrgRateRow>();
  const senderIds = new Map<string, SenderRow>();
  const orgCountries = new Map<string, OrgCountryRow>();
  const balances = new Map<string, BalanceRow>();
  const ledger: LedgerRow[] = [];
  const settings = new Map<string, SettingRow>();

  function timed<T extends object>(data: T & { id?: string }): T & Timed & { id: string } {
    const now = new Date();
    return { id: data.id ?? randomUUID(), createdAt: now, updatedAt: now, ...data };
  }

  return {
    clearOrganization(organizationId: string) {
      for (const [id, row] of senderIds) {
        if (row.organizationId === organizationId) {
          senderIds.delete(id);
        }
      }
      for (const [id, row] of orgCountries) {
        if (row.organizationId === organizationId) {
          orgCountries.delete(id);
        }
      }
      for (const [id, row] of orgRates) {
        if (row.organizationId === organizationId) {
          orgRates.delete(id);
        }
      }
      balances.delete(organizationId);
      for (let index = ledger.length - 1; index >= 0; index -= 1) {
        if (ledger[index]?.organizationId === organizationId) {
          ledger.splice(index, 1);
        }
      }
    },
    delegates: {
      provider: {
        findMany: (args?: { where?: Where; orderBy?: Record<string, 'asc' | 'desc'> }) =>
          Promise.resolve(listed(providers.values(), args)),
        findUnique: ({ where }: { where: { id: string } }) =>
          Promise.resolve(providers.get(where.id) ?? null),
        create: ({
          data,
        }: {
          data: Omit<ProviderRow, 'id' | 'createdAt' | 'updatedAt'> & Partial<ProviderRow>;
        }) => {
          if ([...providers.values()].some((row) => row.code === data.code)) {
            uniqueConflict();
          }
          const row = timed(data);
          providers.set(row.id, row);
          return Promise.resolve(row);
        },
        update: ({ where, data }: { where: { id: string }; data: Partial<ProviderRow> }) => {
          const row = providers.get(where.id);
          if (row === undefined) {
            throw new Error(`missing provider ${where.id}`);
          }
          Object.assign(row, data, { updatedAt: new Date() });
          return Promise.resolve(row);
        },
      },
      route: {
        findMany: (args?: { where?: Where; orderBy?: Record<string, 'asc' | 'desc'> }) =>
          Promise.resolve(listed(routes.values(), args)),
        findUnique: ({ where }: { where: { id: string } }) =>
          Promise.resolve(routes.get(where.id) ?? null),
        create: ({
          data,
        }: {
          data: Omit<RouteRow, 'id' | 'createdAt' | 'updatedAt' | 'markupPercent' | 'enabled'> &
            Partial<RouteRow>;
        }) => {
          const duplicate = [...routes.values()].some(
            (row) =>
              row.countryIso2 === data.countryIso2 &&
              row.mccmnc === (data.mccmnc ?? null) &&
              row.providerId === data.providerId,
          );
          if (duplicate) {
            uniqueConflict();
          }
          const row = timed({
            ...data,
            markupPercent: data.markupPercent ?? null,
            enabled: data.enabled ?? true,
            mccmnc: data.mccmnc ?? null,
          });
          routes.set(row.id, row);
          return Promise.resolve(row);
        },
        update: ({ where, data }: { where: { id: string }; data: Partial<RouteRow> }) => {
          const row = routes.get(where.id);
          if (row === undefined) {
            throw new Error(`missing route ${where.id}`);
          }
          Object.assign(row, data, { updatedAt: new Date() });
          return Promise.resolve(row);
        },
        delete: ({ where }: { where: { id: string } }) => {
          const row = routes.get(where.id);
          if (row === undefined) {
            throw new Error(`missing route ${where.id}`);
          }
          routes.delete(where.id);
          return Promise.resolve(row);
        },
      },
      rate: {
        findMany: (args?: { where?: Where }) => Promise.resolve(listed(rates.values(), args)),
        create: ({
          data,
        }: {
          data: Omit<RateRow, 'id' | 'createdAt' | 'updatedAt' | 'mccmnc'> & Partial<RateRow>;
        }) => {
          const row = timed({ ...data, mccmnc: data.mccmnc ?? null });
          rates.set(row.id, row);
          return Promise.resolve(row);
        },
        deleteMany: ({ where }: { where: Where }) =>
          Promise.resolve(removeWhere(rates, where, (row) => row.id)),
      },
      orgRate: {
        findMany: (args?: { where?: Where }) => Promise.resolve(listed(orgRates.values(), args)),
        create: ({
          data,
        }: {
          data: Omit<OrgRateRow, 'id' | 'createdAt' | 'updatedAt' | 'mccmnc'> & Partial<OrgRateRow>;
        }) => {
          const row = timed({ ...data, mccmnc: data.mccmnc ?? null });
          orgRates.set(row.id, row);
          return Promise.resolve(row);
        },
        deleteMany: ({ where }: { where: Where }) =>
          Promise.resolve(removeWhere(orgRates, where, (row) => row.id)),
      },
      orgBalance: {
        findMany: (args?: { where?: Where }) => Promise.resolve(listed(balances.values(), args)),
        findUnique: ({ where }: { where: { organizationId: string } }) =>
          Promise.resolve(balances.get(where.organizationId) ?? null),
        create: ({
          data,
        }: {
          data: Omit<BalanceRow, 'createdAt' | 'updatedAt'> & Partial<BalanceRow>;
        }) => {
          if (balances.has(data.organizationId)) {
            uniqueConflict();
          }
          const now = new Date();
          const row: BalanceRow = {
            ...data,
            createdAt: now,
            updatedAt: now,
          };
          balances.set(row.organizationId, row);
          return Promise.resolve(row);
        },
        updateMany: ({
          where,
          data,
        }: {
          where: { organizationId?: unknown; availableMicros?: unknown; heldMicros?: unknown };
          data: { availableMicros?: unknown; heldMicros?: unknown };
        }) => {
          const hits = [...balances.values()].filter((row) => {
            if (
              typeof where.organizationId === 'string' &&
              row.organizationId !== where.organizationId
            ) {
              return false;
            }
            if (
              typeof where.organizationId === 'object' &&
              where.organizationId !== null &&
              !matches(row, { organizationId: where.organizationId })
            ) {
              return false;
            }
            return (
              amountAllows(row.availableMicros, where.availableMicros) &&
              amountAllows(row.heldMicros, where.heldMicros)
            );
          });
          for (const row of hits) {
            if (data.availableMicros !== undefined) {
              row.availableMicros = nextAmount(row.availableMicros, data.availableMicros);
            }
            if (data.heldMicros !== undefined) {
              row.heldMicros = nextAmount(row.heldMicros, data.heldMicros);
            }
            row.updatedAt = new Date();
          }
          return Promise.resolve({ count: hits.length });
        },
      },
      ledgerEntry: {
        findMany: (args?: { where?: Where; orderBy?: Record<string, 'asc' | 'desc'> }) =>
          Promise.resolve(listed(ledger, args)),
        findFirst: ({ where }: { where: Where }) =>
          Promise.resolve(ledger.find((row) => matches(row, where)) ?? null),
        create: ({
          data,
        }: {
          data: Omit<LedgerRow, 'id' | 'createdAt' | 'updatedAt' | 'refType' | 'refId' | 'note'> &
            Partial<LedgerRow>;
        }) => {
          const row = timed({
            ...data,
            refType: data.refType ?? null,
            refId: data.refId ?? null,
            note: data.note ?? null,
          });
          ledger.push(row);
          return Promise.resolve(row);
        },
      },
      senderId: {
        findMany: (args?: { where?: Where; orderBy?: Record<string, 'asc' | 'desc'> }) =>
          Promise.resolve(listed(senderIds.values(), args)),
        findFirst: ({ where }: { where: Where }) =>
          Promise.resolve([...senderIds.values()].find((row) => matches(row, where)) ?? null),
        create: ({
          data,
        }: {
          data: Omit<
            SenderRow,
            'id' | 'createdAt' | 'updatedAt' | 'reviewNote' | 'status' | 'intendedCountries'
          > &
            Partial<SenderRow>;
        }) => {
          const duplicate = [...senderIds.values()].some(
            (row) => row.organizationId === data.organizationId && row.value === data.value,
          );
          if (duplicate) {
            uniqueConflict();
          }
          const row = timed({
            ...data,
            reviewNote: data.reviewNote ?? null,
            status: data.status ?? 'PENDING',
            intendedCountries: data.intendedCountries ?? [],
          });
          senderIds.set(row.id, row);
          return Promise.resolve(row);
        },
      },
      orgCountry: {
        findMany: (args?: { where?: Where }) =>
          Promise.resolve(listed(orgCountries.values(), args)),
        findFirst: ({ where }: { where: Where }) =>
          Promise.resolve([...orgCountries.values()].find((row) => matches(row, where)) ?? null),
        create: ({
          data,
        }: {
          data: Omit<
            OrgCountryRow,
            'id' | 'createdAt' | 'updatedAt' | 'senderIdId' | 'registrationComplete'
          > &
            Partial<OrgCountryRow>;
        }) => {
          const duplicate = [...orgCountries.values()].some(
            (row) =>
              row.organizationId === data.organizationId && row.countryIso2 === data.countryIso2,
          );
          if (duplicate) {
            uniqueConflict();
          }
          const row = timed({
            ...data,
            senderIdId: data.senderIdId ?? null,
            registrationComplete: data.registrationComplete ?? false,
          });
          orgCountries.set(row.id, row);
          return Promise.resolve(row);
        },
        delete: ({ where }: { where: { id: string } }) => {
          const row = orgCountries.get(where.id);
          if (row === undefined) {
            throw new Error(`missing org country ${where.id}`);
          }
          orgCountries.delete(where.id);
          return Promise.resolve(row);
        },
      },
      platformSetting: {
        findUnique: ({ where }: { where: { id: string } }) =>
          Promise.resolve(settings.get(where.id) ?? null),
        create: ({ data }: { data: Omit<SettingRow, 'createdAt' | 'updatedAt'> }) => {
          if (settings.has(data.id)) {
            uniqueConflict();
          }
          const now = new Date();
          const row: SettingRow = { createdAt: now, updatedAt: now, ...data };
          settings.set(row.id, row);
          return Promise.resolve(row);
        },
        upsert: ({
          where,
          create,
          update,
        }: {
          where: { id: string };
          create: Omit<SettingRow, 'createdAt' | 'updatedAt'>;
          update: Partial<SettingRow>;
        }) => {
          const existing = settings.get(where.id);
          if (existing !== undefined) {
            Object.assign(existing, update, { updatedAt: new Date() });
            return Promise.resolve(existing);
          }
          const now = new Date();
          const row: SettingRow = { createdAt: now, updatedAt: now, ...create };
          settings.set(row.id, row);
          return Promise.resolve(row);
        },
      },
    },
  };
}

export function createMemoryRedis() {
  const strings = new Map<string, string>();
  const sets = new Map<string, Map<string, number>>();
  return {
    status: 'ready' as const,
    ping: () => Promise.resolve('PONG'),
    quit: () => Promise.resolve('OK'),
    set: (key: string, value: string) => {
      strings.set(key, value);
      return Promise.resolve('OK');
    },
    getdel: (key: string) => {
      const value = strings.get(key) ?? null;
      strings.delete(key);
      return Promise.resolve(value);
    },
    call: (command: string, key: string) => {
      if (command === 'ZRANGE') {
        const set = sets.get(key);
        if (set === undefined || set.size === 0) {
          return Promise.resolve([]);
        }
        const oldest = [...set.entries()].sort((left, right) => left[1] - right[1])[0];
        return Promise.resolve(oldest === undefined ? [] : [oldest[0], String(oldest[1])]);
      }
      return Promise.resolve(null);
    },
    multi() {
      const operations: (() => number)[] = [];
      const chain = {
        zremrangebyscore: (key: string, min: number, max: number) => {
          operations.push(() => {
            const set = sets.get(key);
            if (set === undefined) {
              return 0;
            }
            for (const [member, score] of set) {
              if (score >= min && score <= max) {
                set.delete(member);
              }
            }
            return 1;
          });
          return chain;
        },
        zadd: (key: string, score: number, member: string) => {
          operations.push(() => {
            const set = sets.get(key) ?? new Map<string, number>();
            set.set(member, score);
            sets.set(key, set);
            return 1;
          });
          return chain;
        },
        zcard: (key: string) => {
          operations.push(() => sets.get(key)?.size ?? 0);
          return chain;
        },
        pexpire: () => {
          operations.push(() => 1);
          return chain;
        },
        exec: () =>
          Promise.resolve(operations.map((operation) => [null, operation()] as [null, number])),
      };
      return chain;
    },
  };
}
