import { Prisma, type PrismaClient } from '@smsvio/db';
import { SEND_QUEUE_KEY } from '@smsvio/shared';
import { DEFAULT_REPLIES, matchAutoReply, type AutoReplyRule } from '@smsvio/shared/compliance';

import { publishCustomerEvent, type CustomerEventInput } from './customer-event.js';

export interface InboundText {
  readonly from: string;
  readonly to: string;
  readonly body: string;
}

interface EventRedis {
  lpush(key: string, value: string): Promise<unknown>;
}

/** The organization is the one that most recently sent to this handset. */
export async function attributeInbound(db: PrismaClient, from: string): Promise<string | null> {
  const previous = await db.message.findFirst({
    where: { direction: 'OUTBOUND', to: from },
    orderBy: { createdAt: 'desc' },
    select: { organizationId: true },
  });
  return previous?.organizationId ?? null;
}

/**
 * Stores the inbound message, applies opt-out, opt-in, or help, and queues the confirmation.
 * The confirmation is not billed, so it can still be sent to a number that just opted out.
 */
export async function applyInbound(
  db: PrismaClient,
  redis: EventRedis,
  organizationId: string,
  inbound: InboundText,
): Promise<'opt_out' | 'opt_in' | 'help' | 'stored'> {
  const rules = await ensureReplies(db, organizationId);
  const stored = await db.message.create({
    data: messageData(
      organizationId,
      inbound.from,
      inbound.to,
      inbound.body,
      'INBOUND',
      'DELIVERED',
    ),
  });
  await publishCustomerEvent(db, redis, {
    organizationId,
    type: 'message.received',
    data: received(stored.id, inbound),
  });
  const rule = matchAutoReply(rules, inbound.body);
  if (rule === null) {
    return 'stored';
  }
  if (rule.category === 'OPT_OUT') {
    await db.optOut.upsert({
      where: { organizationId_phoneE164: { organizationId, phoneE164: inbound.from } },
      create: { organizationId, phoneE164: inbound.from, source: 'keyword' },
      update: { source: 'keyword' },
    });
    await setContacts(db, organizationId, inbound.from, true);
  } else if (rule.category === 'OPT_IN') {
    await db.optOut.deleteMany({ where: { organizationId, phoneE164: inbound.from } });
    await setContacts(db, organizationId, inbound.from, false);
  }
  const confirmation = await db.message.create({
    data: messageData(organizationId, inbound.to, inbound.from, rule.body, 'OUTBOUND', 'QUEUED'),
  });
  await redis.lpush(SEND_QUEUE_KEY, confirmation.id);
  if (rule.category === 'OPT_OUT') {
    return 'opt_out';
  }
  if (rule.category === 'OPT_IN') {
    return 'opt_in';
  }
  return 'help';
}

async function ensureReplies(db: PrismaClient, organizationId: string): Promise<AutoReplyRule[]> {
  const existing = await db.autoReply.findMany({ where: { organizationId } });
  if (existing.length > 0) {
    return existing;
  }
  for (const reply of DEFAULT_REPLIES) {
    await db.autoReply.create({
      data: {
        organizationId,
        category: reply.category,
        keywords: [...reply.keywords],
        body: reply.body,
        protected: true,
      },
    });
  }
  return db.autoReply.findMany({ where: { organizationId } });
}

async function setContacts(
  db: PrismaClient,
  organizationId: string,
  phoneE164: string,
  optedOut: boolean,
): Promise<void> {
  const contacts = await db.contact.findMany({ where: { organizationId, phoneE164 } });
  for (const contact of contacts) {
    await db.contact.update({ where: { id: contact.id }, data: { optedOut } });
  }
}

function messageData(
  organizationId: string,
  from: string,
  to: string,
  body: string,
  direction: 'INBOUND' | 'OUTBOUND',
  status: 'DELIVERED' | 'QUEUED',
): Prisma.MessageUncheckedCreateInput {
  return {
    organizationId,
    direction,
    to,
    fromSender: from,
    body,
    encoding: 'GSM-7',
    segments: 1,
    status,
    billable: false,
    priceMicros: null,
    queuedAt: status === 'QUEUED' ? new Date() : null,
  };
}

function received(id: string, inbound: InboundText): CustomerEventInput['data'] {
  return { id, from: inbound.from, to: inbound.to, body: inbound.body };
}
