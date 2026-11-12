import { randomBytes } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Prisma } from '@smsvio/db';
import type { PrismaClient } from '@smsvio/db';
import { SMS_ERRORS, smsErrorMessage, type SmsErrorCode } from '@smsvio/shared';
import { PRISMA, REDIS } from '@smsvio/server';
import type { Redis } from 'ioredis';

import type { AuthState } from '../accounts/support.js';
import { assertCapability } from '../accounts/support.js';
import { API_ENV } from '../config.js';
import type { ApiEnv } from '../env.js';
import { MAILER, type Mailer, emailSubject } from '../mail/mailer.js';
import { notFound, presentMoney } from './present.js';

const INLINE_EXPORT_ROWS = 1_000;
const EXPORT_TTL_SECONDS = 24 * 60 * 60;

interface ListQuery {
  readonly q?: string;
  readonly status?: string;
  readonly direction?: string;
  readonly country?: string;
  readonly templateId?: string;
  readonly apiKeyId?: string;
  readonly from?: string;
  readonly to?: string;
  readonly page: number;
  readonly pageSize: number;
}

interface ExportRedis {
  set(key: string, value: string, expiry: 'EX', seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

@Injectable()
export class MessageQueryService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Optional() @Inject(REDIS) private readonly redis?: ExportRedis | Redis,
    @Optional() @Inject(MAILER) private readonly mailer?: Mailer,
    @Optional() @Inject(API_ENV) private readonly env?: ApiEnv,
  ) {}

  async list(state: AuthState, query: ListQuery) {
    assertCapability(state, 'view');
    const where = this.where(state.organizationId, query);
    const [total, rows] = await Promise.all([
      this.prisma.message.count({ where }),
      this.prisma.message.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { template: { select: { name: true } } },
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: rows.map((row) => presentRow(row, row.template?.name ?? null)),
    };
  }

  async get(state: AuthState, id: string) {
    assertCapability(state, 'view');
    const message = await this.prisma.message.findFirst({
      where: { id, organizationId: state.organizationId },
      include: {
        template: { select: { name: true, category: true } },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (message === null) {
      throw notFound();
    }
    return presentDetail(message);
  }

  async activity(state: AuthState, ids: readonly string[]) {
    assertCapability(state, 'view');
    const rows = [];
    for (const id of [...new Set(ids)].slice(0, 8)) {
      const message = await this.prisma.message.findFirst({
        where: { id, organizationId: state.organizationId },
        include: {
          template: { select: { name: true, category: true } },
          events: { orderBy: { createdAt: 'asc' as const } },
        },
      });
      if (message === null) {
        continue;
      }
      rows.push(presentDetail(message));
    }
    return rows;
  }

  async export(
    state: AuthState,
    query: ListQuery,
  ): Promise<{ kind: 'csv'; body: string } | { kind: 'queued'; message: string }> {
    assertCapability(state, 'view');
    const where = this.where(state.organizationId, query);
    const total = await this.prisma.message.count({ where });
    const rows = await this.prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: total > INLINE_EXPORT_ROWS ? 20_000 : INLINE_EXPORT_ROWS,
      include: { template: { select: { name: true } } },
    });
    const body = toCsv(rows);
    if (total <= INLINE_EXPORT_ROWS || this.redis === undefined || this.mailer === undefined) {
      return { kind: 'csv', body };
    }
    const token = randomBytes(16).toString('hex');
    await this.redis.set(`smsvio:export:${token}`, body, 'EX', EXPORT_TTL_SECONDS);
    const origin = this.env?.PUBLIC_ORIGIN ?? '';
    const link = `${origin}/api/exports/${token}`;
    await this.mailer.send({
      to: state.body.user.email,
      subject: emailSubject('Your SMSVIO message export'),
      text: `Download the CSV: ${link}`,
      html: `<p><a href="${link}">Download the CSV</a>. The link expires in 24 hours.</p>`,
    });
    return { kind: 'queued', message: 'We emailed the download link. It expires in 24 hours.' };
  }

  private where(organizationId: string, query: ListQuery): Prisma.MessageWhereInput {
    const needle = query.q?.trim();
    return {
      organizationId,
      ...(query.status === undefined
        ? {}
        : { status: query.status as Prisma.MessageWhereInput['status'] }),
      ...(query.direction === undefined
        ? {}
        : { direction: query.direction as Prisma.MessageWhereInput['direction'] }),
      ...(query.country === undefined ? {} : { countryIso2: query.country }),
      ...(query.templateId === undefined ? {} : { templateId: query.templateId }),
      ...(query.apiKeyId === undefined ? {} : { apiKeyId: query.apiKeyId }),
      ...createdBetween(query.from, query.to),
      ...(needle === undefined || needle === ''
        ? {}
        : {
            OR: [
              { id: needle },
              { to: { contains: needle } },
              { fromSender: { contains: needle } },
            ],
          }),
    };
  }
}

function presentRow(
  message: {
    id: string;
    to: string;
    fromSender: string;
    direction: string;
    status: string;
    segments: number;
    priceMicros: bigint | null;
    createdAt: Date;
    countryIso2: string | null;
  },
  templateName: string | null,
) {
  return {
    id: message.id,
    shortId: message.id.slice(0, 8),
    to: message.to,
    from: message.fromSender,
    direction: message.direction.toLowerCase(),
    status: message.status.toLowerCase(),
    segments: message.segments,
    price: presentMoney(message.priceMicros ?? 0n, 4),
    countryIso2: message.countryIso2,
    templateName,
    createdAt: message.createdAt.toISOString(),
  };
}

export async function readMessageExport(
  redis: Pick<ExportRedis, 'get'>,
  token: string,
): Promise<string | null> {
  if (!/^[a-f0-9]{32}$/.test(token)) {
    return null;
  }
  return redis.get(`smsvio:export:${token}`);
}

function createdBetween(
  from: string | undefined,
  to: string | undefined,
): { createdAt?: { gte?: Date; lt?: Date } } {
  if (from === undefined && to === undefined) {
    return {};
  }
  const createdAt: { gte?: Date; lt?: Date } = {};
  if (from !== undefined) {
    createdAt.gte = new Date(`${from}T00:00:00.000Z`);
  }
  if (to !== undefined) {
    const end = new Date(`${to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    createdAt.lt = end;
  }
  return { createdAt };
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function toCsv(
  rows: {
    id: string;
    to: string;
    fromSender: string;
    direction: string;
    status: string;
    segments: number;
    priceMicros: bigint | null;
    countryIso2: string | null;
    createdAt: Date;
    template: { name: string } | null;
  }[],
): string {
  const header = 'id,to,from,template,direction,status,segments,price,country,created';
  const lines = rows.map((row) =>
    [
      row.id,
      row.to,
      row.fromSender,
      row.template?.name ?? '',
      row.direction,
      row.status,
      String(row.segments),
      (row.priceMicros ?? 0n).toString(),
      row.countryIso2 ?? '',
      row.createdAt.toISOString(),
    ]
      .map(csvCell)
      .join(','),
  );
  return [header, ...lines].join('\n');
}

function presentDetail(message: {
  id: string;
  to: string;
  fromSender: string;
  direction: string;
  status: string;
  segments: number;
  priceMicros: bigint | null;
  createdAt: Date;
  countryIso2: string | null;
  body: string;
  errorCode: string | null;
  mccmnc: string | null;
  template: { name: string; category: string } | null;
  events: { status: string; detail: string | null; createdAt: Date }[];
}): ReturnType<typeof presentRow> & {
  body: string;
  templateCategory: string | null;
  errorCode: string | null;
  error: string | null;
  mccmnc: string | null;
  events: { status: string; detail: string | null; at: string }[];
} {
  return {
    ...presentRow(message, message.template?.name ?? null),
    body: message.body,
    templateCategory: message.template?.category ?? null,
    errorCode: message.errorCode,
    error: explain(message.errorCode),
    mccmnc: message.mccmnc,
    events: message.events.map((event) => ({
      status: event.status.toLowerCase(),
      detail: event.detail,
      at: event.createdAt.toISOString(),
    })),
  };
}

function explain(code: string | null): string | null {
  if (code === null || !(code in SMS_ERRORS)) {
    return null;
  }
  return smsErrorMessage(code as SmsErrorCode);
}
