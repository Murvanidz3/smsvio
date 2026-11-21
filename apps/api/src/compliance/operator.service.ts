import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@smsvio/db';
import { PRISMA, REDIS } from '@smsvio/server';
import { RECEIPT_QUEUE_KEY, SEND_DELAY_KEY, SEND_QUEUE_KEY } from '@smsvio/shared';
import { DEFAULT_DAILY_SPEND_CAP_MICROS, PLATFORM_SETTING_ID } from '@smsvio/shared/billing';
import type { Redis } from 'ioredis';

import { assertPlatformAdmin, writeAudit, type AuthState } from '../accounts/support.js';
import { ApiError } from '../http/api-error.js';
import type { ClientInfo } from '../http/client.js';
import { MAILER, type Mailer } from '../mail/mailer.js';
import { presentMoney } from '../messaging/present.js';

const WEBHOOK_QUEUE = 'smsvio:q:webhook.deliver';
const WEBHOOK_DELAY = 'smsvio:q:webhook.deliver:delay';

@Injectable()
export class OperatorService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  async reviews(state: AuthState) {
    assertPlatformAdmin(state);
    const [profiles, organizations, useCases, senders, templates] = await Promise.all([
      this.prisma.complianceProfile.findMany(),
      this.prisma.organization.findMany(),
      this.prisma.useCase.findMany({ where: { status: 'PENDING' }, take: 50 }),
      this.prisma.senderId.findMany({ where: { status: 'PENDING' }, take: 50 }),
      this.prisma.template.findMany({ where: { status: 'PENDING' }, take: 50 }),
    ]);
    const orgs = new Map(organizations.map((organization) => [organization.id, organization]));
    return {
      verification: profiles.flatMap((profile) => {
        const organization = orgs.get(profile.organizationId);
        if (organization?.status !== 'PENDING_VERIFICATION' || Boolean(profile.reviewNote)) {
          return [];
        }
        return [
          {
            organizationId: profile.organizationId,
            name: organization.name,
            legalName: profile.legalName,
            country: profile.registrationCountry,
            submittedAt: profile.submittedAt.toISOString(),
          },
        ];
      }),
      useCases: useCases.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        purpose: row.purpose,
      })),
      senders: senders.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        value: row.value,
        useCase: row.useCase,
      })),
      templates: templates.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        name: row.name,
      })),
    };
  }

  async decideVerification(
    state: AuthState,
    organizationId: string,
    decision: 'approve' | 'reject',
    note: string | undefined,
    client: ClientInfo,
  ) {
    assertPlatformAdmin(state);
    const profile = await this.prisma.complianceProfile.findUnique({ where: { organizationId } });
    if (profile === null) {
      throw new ApiError(404, 'not_found', 'That verification does not exist.');
    }
    await this.prisma.complianceProfile.update({
      where: { organizationId },
      data: {
        reviewNote:
          note ??
          (decision === 'approve'
            ? 'Your business is verified.'
            : 'Update the form and submit again.'),
      },
    });
    if (decision === 'approve') {
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: { status: 'ACTIVE' },
      });
    }
    await this.mail(
      organizationId,
      decision === 'approve' ? 'SMSVIO verification approved' : 'SMSVIO verification needs changes',
      note ??
        (decision === 'approve'
          ? 'Your business is verified.'
          : 'Update the form and submit again.'),
    );
    await writeAudit(this.prisma, {
      organizationId,
      actorUserId: state.userId,
      action: `compliance.${decision}`,
      targetType: 'organization',
      targetId: organizationId,
      ip: client.ip,
      meta: { note: note ?? '' },
    });
    return {
      message: decision === 'approve' ? 'Verification approved.' : 'Verification rejected.',
    };
  }

  async decideUseCase(
    state: AuthState,
    id: string,
    decision: 'approve' | 'reject',
    note: string | undefined,
    client: ClientInfo,
  ) {
    return this.decideRow(state, 'useCase', id, decision, note, client);
  }

  async decideSender(
    state: AuthState,
    id: string,
    decision: 'approve' | 'reject',
    note: string | undefined,
    client: ClientInfo,
  ) {
    return this.decideRow(state, 'sender', id, decision, note, client);
  }

  async decideTemplate(
    state: AuthState,
    id: string,
    decision: 'approve' | 'reject',
    note: string | undefined,
    client: ClientInfo,
  ) {
    return this.decideRow(state, 'template', id, decision, note, client);
  }

  async messages(
    state: AuthState,
    query: {
      q?: string;
      status?: string;
      organizationId?: string;
      errorCode?: string;
      page: number;
      pageSize: number;
    },
  ) {
    assertPlatformAdmin(state);
    const where: Prisma.MessageWhereInput = {};
    if (query.q !== undefined && query.q !== '') {
      where.OR = [
        { to: { contains: query.q } },
        { fromSender: { contains: query.q } },
        { id: query.q },
      ];
    }
    if (query.status !== undefined) {
      where.status = query.status as Prisma.MessageWhereInput['status'];
    }
    if (query.organizationId !== undefined) {
      where.organizationId = query.organizationId;
    }
    if (query.errorCode !== undefined) {
      where.errorCode = query.errorCode;
    }
    const [total, rows] = await Promise.all([
      this.prisma.message.count({ where }),
      this.prisma.message.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: rows.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        to: row.to,
        from: row.fromSender,
        status: row.status,
        direction: row.direction,
        countryIso2: row.countryIso2,
        errorCode: row.errorCode,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async health(state: AuthState) {
    assertPlatformAdmin(state);
    const since = new Date(Date.now() - 5 * 60 * 1000);
    const day = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [send, delayed, receipts, webhooks, webhookDelay, lagging, failures, stuck] =
      await Promise.all([
        this.redis.llen(SEND_QUEUE_KEY),
        this.redis.zcard(SEND_DELAY_KEY),
        this.redis.zcard(RECEIPT_QUEUE_KEY),
        this.redis.llen(WEBHOOK_QUEUE),
        this.redis.zcard(WEBHOOK_DELAY),
        this.prisma.message.count({ where: { status: 'SENT', sentAt: { lt: since } } }),
        this.prisma.message.findMany({
          where: {
            status: { in: ['FAILED', 'UNDELIVERED', 'REJECTED'] },
            createdAt: { gte: day },
          },
          select: { providerId: true, errorCode: true },
        }),
        this.prisma.message.findMany({
          where: { status: 'SENT', sentAt: { lt: since } },
          orderBy: { sentAt: 'asc' },
          take: 25,
          select: {
            id: true,
            organizationId: true,
            to: true,
            sentAt: true,
            providerId: true,
          },
        }),
      ]);
    const byProvider = new Map<string, number>();
    const byError = new Map<string, number>();
    for (const failure of failures) {
      const key = failure.providerId ?? 'none';
      byProvider.set(key, (byProvider.get(key) ?? 0) + 1);
      const code = failure.errorCode ?? 'unknown';
      byError.set(code, (byError.get(code) ?? 0) + 1);
    }
    return {
      queues: { send, delayed, receipts, webhooks, webhookDelay },
      receiptLag: lagging,
      providerErrors: [...byProvider.entries()].map(([providerId, count]) => ({
        providerId,
        count,
      })),
      errorGroups: [...byError.entries()]
        .map(([errorCode, count]) => ({ errorCode, count }))
        .sort((left, right) => right.count - left.count),
      stuck: stuck.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        to: row.to,
        providerId: row.providerId,
        sentAt: row.sentAt?.toISOString() ?? null,
      })),
    };
  }

  async operations(state: AuthState) {
    assertPlatformAdmin(state);
    const start = utcStart(new Date());
    const minuteAgo = new Date(Date.now() - 60_000);
    const [
      setting,
      routes,
      providers,
      organizations,
      today,
      recent,
      open,
      send,
      delayed,
      receipts,
    ] = await Promise.all([
      this.prisma.platformSetting.findUnique({ where: { id: PLATFORM_SETTING_ID } }),
      this.prisma.route.findMany(),
      this.prisma.provider.findMany(),
      this.prisma.organization.findMany(),
      this.prisma.message.findMany({
        where: { createdAt: { gte: start } },
        select: { routeId: true, status: true },
      }),
      this.prisma.message.findMany({
        where: { sentAt: { gte: minuteAgo } },
        select: { routeId: true },
      }),
      this.prisma.message.findMany({
        where: { status: { in: ['QUEUED', 'SENDING'] } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.redis.llen(SEND_QUEUE_KEY),
      this.redis.zcard(SEND_DELAY_KEY),
      this.redis.zcard(RECEIPT_QUEUE_KEY),
    ]);
    const names = new Map(
      organizations.map((organization) => [organization.id, organization.name]),
    );
    const providerById = new Map(providers.map((provider) => [provider.id, provider]));
    const byRoute = new Map<string, Tally>();
    const overall = emptyTally();
    for (const row of today) {
      addStatus(overall, row.status);
      const key = row.routeId ?? '';
      const tally = byRoute.get(key) ?? emptyTally();
      addStatus(tally, row.status);
      byRoute.set(key, tally);
    }
    const lastMinute = new Map<string, number>();
    for (const row of recent) {
      const key = row.routeId ?? '';
      lastMinute.set(key, (lastMinute.get(key) ?? 0) + 1);
    }
    return {
      paused: setting?.sendingPaused === true,
      today: presentTally(overall),
      queues: { send, delayed, receipts },
      routes: routes
        .map((route) => {
          const provider = providerById.get(route.providerId);
          return {
            id: route.id,
            countryIso2: route.countryIso2,
            mccmnc: route.mccmnc,
            providerCode: provider?.code ?? '',
            providerType: provider?.type ?? '',
            enabled: route.enabled,
            maxTps: provider?.maxTps ?? 0,
            lastMinute: lastMinute.get(route.id) ?? 0,
            ...presentTally(byRoute.get(route.id) ?? emptyTally()),
          };
        })
        .sort(
          (left, right) =>
            right.total - left.total || left.countryIso2.localeCompare(right.countryIso2),
        ),
      open: open.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        organizationName: names.get(row.organizationId) ?? '',
        to: row.to,
        from: row.fromSender,
        status: row.status,
        countryIso2: row.countryIso2,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async statistics(state: AuthState, day: string | undefined) {
    assertPlatformAdmin(state);
    const date = day ?? utcDay(new Date());
    const start = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== date) {
      throw new ApiError(400, 'invalid_input', 'That day is not a real UTC date.');
    }
    const end = new Date(start.getTime() + 86_400_000);
    const [routes, providers, organizations, rows] = await Promise.all([
      this.prisma.route.findMany(),
      this.prisma.provider.findMany(),
      this.prisma.organization.findMany(),
      this.prisma.message.findMany({
        where: { createdAt: { gte: start, lt: end } },
        select: { routeId: true, organizationId: true, status: true },
      }),
    ]);
    const providerById = new Map(providers.map((provider) => [provider.id, provider]));
    const routeById = new Map(routes.map((route) => [route.id, route]));
    const names = new Map(
      organizations.map((organization) => [organization.id, organization.name]),
    );
    const byRoute = new Map<string, Tally>();
    const byOrganization = new Map<string, Tally>();
    for (const row of rows) {
      const routeKey = row.routeId ?? '';
      const routeTally = byRoute.get(routeKey) ?? emptyTally();
      addStatus(routeTally, row.status);
      byRoute.set(routeKey, routeTally);
      const orgTally = byOrganization.get(row.organizationId) ?? emptyTally();
      addStatus(orgTally, row.status);
      byOrganization.set(row.organizationId, orgTally);
    }
    return {
      day: date,
      byRoute: [...byRoute.entries()]
        .map(([routeId, tally]) => {
          const route = routeById.get(routeId);
          const provider = route === undefined ? undefined : providerById.get(route.providerId);
          return {
            routeId,
            countryIso2: route?.countryIso2 ?? '',
            providerCode: provider?.code ?? '',
            ...presentTally(tally),
          };
        })
        .sort((left, right) => right.total - left.total),
      byOrganization: [...byOrganization.entries()]
        .map(([organizationId, tally]) => ({
          organizationId,
          name: names.get(organizationId) ?? '',
          ...presentTally(tally),
        }))
        .sort((left, right) => right.total - left.total),
    };
  }

  async setSendingPaused(state: AuthState, paused: boolean, client: ClientInfo) {
    assertPlatformAdmin(state);
    await this.prisma.platformSetting.upsert({
      where: { id: PLATFORM_SETTING_ID },
      create: {
        id: PLATFORM_SETTING_ID,
        defaultDailySpendCapMicros: DEFAULT_DAILY_SPEND_CAP_MICROS,
        sharedSender: null,
        sendingPaused: paused,
      },
      update: { sendingPaused: paused },
    });
    await writeAudit(this.prisma, {
      organizationId: null,
      actorUserId: state.userId,
      action: 'platform.sending_paused',
      targetType: 'platform_setting',
      targetId: PLATFORM_SETTING_ID,
      ip: client.ip,
      meta: { paused },
    });
    return {
      paused,
      message: paused ? 'Sending is paused.' : 'Sending is running.',
    };
  }

  async margin(state: AuthState) {
    assertPlatformAdmin(state);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.message.findMany({
      where: {
        billable: true,
        status: { in: ['SENT', 'DELIVERED', 'UNDELIVERED', 'EXPIRED'] },
        createdAt: { gte: since },
      },
      select: { countryIso2: true, providerId: true, priceMicros: true, costMicros: true },
    });
    const groups = new Map<
      string,
      { country: string; providerId: string; revenue: bigint; cost: bigint }
    >();
    for (const row of rows) {
      const country = row.countryIso2 ?? '';
      const providerId = row.providerId ?? '';
      const key = `${country}:${providerId}`;
      const current = groups.get(key) ?? { country, providerId, revenue: 0n, cost: 0n };
      current.revenue += row.priceMicros ?? 0n;
      current.cost += row.costMicros ?? 0n;
      groups.set(key, current);
    }
    return {
      items: [...groups.values()].map((group) => ({
        country: group.country,
        providerId: group.providerId,
        revenue: presentMoney(group.revenue, 2),
        cost: presentMoney(group.cost, 2),
        margin: presentMoney(group.revenue - group.cost, 2),
      })),
    };
  }

  async audit(state: AuthState, query: { page: number; pageSize: number }) {
    assertPlatformAdmin(state);
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where: {} }),
      this.prisma.auditLog.findMany({
        where: {},
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        organizationId: row.organizationId,
        targetType: row.targetType,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  private async decideRow(
    state: AuthState,
    kind: 'useCase' | 'sender' | 'template',
    id: string,
    decision: 'approve' | 'reject',
    note: string | undefined,
    client: ClientInfo,
  ) {
    assertPlatformAdmin(state);
    const status = decision === 'approve' ? 'APPROVED' : 'REJECTED';
    if (kind === 'useCase') {
      const row = await this.prisma.useCase.findFirst({ where: { id } });
      if (row === null) {
        throw new ApiError(404, 'not_found', 'That use case does not exist.');
      }
      await this.prisma.useCase.update({
        where: { id },
        data: { status, reviewNote: note ?? null },
      });
      await this.mail(
        row.organizationId,
        `SMSVIO use case ${status.toLowerCase()}`,
        note ?? status,
      );
      await this.auditDecision(state, row.organizationId, 'use_case', id, decision, note, client);
    } else if (kind === 'sender') {
      const row = await this.prisma.senderId.findFirst({ where: { id } });
      if (row === null) {
        throw new ApiError(404, 'not_found', 'That sender does not exist.');
      }
      await this.prisma.senderId.update({
        where: { id },
        data: { status, reviewNote: note ?? null },
      });
      await this.mail(row.organizationId, `SMSVIO sender ${status.toLowerCase()}`, note ?? status);
      await this.auditDecision(state, row.organizationId, 'sender', id, decision, note, client);
    } else {
      const row = await this.prisma.template.findFirst({ where: { id } });
      if (row === null) {
        throw new ApiError(404, 'not_found', 'That template does not exist.');
      }
      await this.prisma.template.update({
        where: { id },
        data: { status, rejectionReason: decision === 'reject' ? (note ?? 'Rejected.') : null },
      });
      await this.mail(
        row.organizationId,
        `SMSVIO template ${status.toLowerCase()}`,
        note ?? status,
      );
      await this.auditDecision(state, row.organizationId, 'template', id, decision, note, client);
    }
    return { message: `${status === 'APPROVED' ? 'Approved' : 'Rejected'}.` };
  }

  private async auditDecision(
    state: AuthState,
    organizationId: string,
    targetType: string,
    targetId: string,
    decision: string,
    note: string | undefined,
    client: ClientInfo,
  ) {
    await writeAudit(this.prisma, {
      organizationId,
      actorUserId: state.userId,
      action: `${targetType}.${decision}`,
      targetType,
      targetId,
      ip: client.ip,
      meta: { note: note ?? '' },
    });
  }

  private async mail(organizationId: string, subject: string, text: string): Promise<void> {
    const members = await this.prisma.membership.findMany({
      where: { organizationId, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } },
      include: { user: { select: { email: true } } },
    });
    for (const member of members) {
      const email = member.user.email;
      if (email === '') {
        continue;
      }
      try {
        await this.mailer.send({ to: email, subject, text, html: text });
      } catch {
        // A missing mail server does not undo the operator's decision.
      }
    }
  }
}

const FINAL_STATUSES = new Set(['DELIVERED', 'UNDELIVERED', 'EXPIRED', 'FAILED', 'REJECTED']);

interface Tally {
  total: number;
  queued: number;
  sending: number;
  sent: number;
  delivered: number;
  failed: number;
  finalCount: number;
}

function emptyTally(): Tally {
  return { total: 0, queued: 0, sending: 0, sent: 0, delivered: 0, failed: 0, finalCount: 0 };
}

function addStatus(tally: Tally, status: string): void {
  tally.total += 1;
  if (status === 'QUEUED') {
    tally.queued += 1;
  } else if (status === 'SENDING') {
    tally.sending += 1;
  } else if (status === 'SENT') {
    tally.sent += 1;
  } else if (status === 'DELIVERED') {
    tally.delivered += 1;
  }
  if (status === 'FAILED' || status === 'REJECTED' || status === 'UNDELIVERED') {
    tally.failed += 1;
  }
  if (FINAL_STATUSES.has(status)) {
    tally.finalCount += 1;
  }
}

function presentTally(tally: Tally) {
  return {
    total: tally.total,
    queued: tally.queued,
    sending: tally.sending,
    sent: tally.sent,
    delivered: tally.delivered,
    failed: tally.failed,
    deliveryRate:
      tally.finalCount === 0 ? null : Math.round((tally.delivered / tally.finalCount) * 100),
  };
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function utcStart(now: Date): Date {
  return new Date(`${utcDay(now)}T00:00:00.000Z`);
}
