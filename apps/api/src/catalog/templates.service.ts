import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@smsvio/db';
import {
  TEMPLATE_GALLERY,
  checkTemplate,
  gallerySample,
  nameFromBody,
  smsErrorMessage,
  templateVariables,
  type TemplateCategory,
  type TemplateStatus,
} from '@smsvio/shared';
import { PRISMA } from '@smsvio/server';

import type { AuthState } from '../accounts/support.js';
import { assertCapability, writeAudit } from '../accounts/support.js';
import type { ApiEnv } from '../env.js';
import { API_ENV } from '../config.js';
import { ApiError } from '../http/api-error.js';
import type { ClientInfo } from '../http/client.js';

interface TemplateInput {
  readonly name?: string;
  readonly category: TemplateCategory;
  readonly language: string;
  readonly body: string;
  readonly samples?: Readonly<Record<string, string>>;
}

interface TemplateRow {
  id: string;
  name: string;
  category: TemplateCategory;
  language: string;
  body: string;
  variables: unknown;
  status: TemplateStatus;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class TemplateService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  gallery(state: AuthState) {
    assertCapability(state, 'view');
    return { items: TEMPLATE_GALLERY };
  }

  async list(
    state: AuthState,
    query: {
      q?: string;
      status?: TemplateStatus;
      category?: TemplateCategory;
      page: number;
      pageSize: number;
    },
  ) {
    assertCapability(state, 'view');
    const where = {
      organizationId: state.organizationId,
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.category === undefined ? {} : { category: query.category }),
      ...(query.q === undefined
        ? {}
        : { name: { contains: query.q, mode: 'insensitive' as const } }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.template.count({ where }),
      this.prisma.template.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: rows.map(presentTemplate),
    };
  }

  async get(state: AuthState, id: string) {
    assertCapability(state, 'view');
    return presentTemplate(await this.find(state.organizationId, id));
  }

  async create(state: AuthState, input: TemplateInput, client: ClientInfo) {
    assertCapability(state, 'messaging');
    const template = await this.prisma.template.create({
      data: { ...fields(input), organizationId: state.organizationId, createdById: state.userId },
    });
    await this.audit(state, client, 'template.created', template.id);
    return presentTemplate(template);
  }

  async copyGallery(state: AuthState, id: string, client: ClientInfo) {
    assertCapability(state, 'messaging');
    const sample = gallerySample(id);
    if (sample === undefined) {
      throw new ApiError(404, 'not_found', 'That sample was not found.');
    }
    return this.create(
      state,
      {
        name: sample.name,
        category: sample.category,
        language: sample.language,
        body: sample.body,
        samples: sample.samples,
      },
      client,
    );
  }

  async update(state: AuthState, id: string, input: TemplateInput, client: ClientInfo) {
    assertCapability(state, 'messaging');
    await this.find(state.organizationId, id);
    const template = await this.prisma.template.update({
      where: { id },
      data: { ...fields(input), status: 'DRAFT', rejectionReason: null },
    });
    await this.audit(state, client, 'template.updated', template.id);
    return presentTemplate(template);
  }

  async submit(state: AuthState, id: string, client: ClientInfo) {
    assertCapability(state, 'messaging');
    const current = await this.find(state.organizationId, id);
    const checked = checkTemplate({
      body: current.body,
      category: current.category,
      samples: sampleMap(current.variables),
      smartEncoding: state.body.organization?.smartEncoding !== false,
    });
    if (checked.analysis.tooLong) {
      throw new ApiError(400, 'message_too_long', smsErrorMessage('message_too_long'));
    }
    const status = this.env.AUTO_APPROVE_TEMPLATES === 'true' ? 'APPROVED' : 'PENDING';
    const template = await this.prisma.template.update({
      where: { id: current.id },
      data: { status, rejectionReason: null },
    });
    await this.audit(state, client, 'template.submitted', template.id, { status });
    return presentTemplate(template);
  }

  async duplicate(state: AuthState, id: string, client: ClientInfo) {
    assertCapability(state, 'messaging');
    const current = await this.find(state.organizationId, id);
    const template = await this.prisma.template.create({
      data: {
        organizationId: state.organizationId,
        createdById: state.userId,
        name: `Copy of ${current.name}`.slice(0, 80),
        category: current.category,
        language: current.language,
        body: current.body,
        variables: sampleMap(current.variables),
        status: 'DRAFT',
      },
    });
    await this.audit(state, client, 'template.duplicated', template.id);
    return presentTemplate(template);
  }

  async remove(state: AuthState, id: string, client: ClientInfo) {
    assertCapability(state, 'messaging');
    const current = await this.find(state.organizationId, id);
    await this.prisma.template.delete({ where: { id: current.id } });
    await this.audit(state, client, 'template.deleted', current.id);
    return { message: 'Template deleted.' };
  }

  async analytics(state: AuthState, id: string, days: number) {
    assertCapability(state, 'view');
    await this.find(state.organizationId, id);
    const now = new Date();
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const start = end - (days - 1) * 24 * 60 * 60 * 1000;
    const messages = await this.prisma.message.findMany({
      where: {
        organizationId: state.organizationId,
        templateId: id,
        createdAt: { gte: new Date(start) },
      },
      select: { status: true, createdAt: true },
    });
    return summarize(messages, start, days);
  }

  private async find(organizationId: string, id: string): Promise<TemplateRow> {
    const template = await this.prisma.template.findFirst({ where: { id, organizationId } });
    if (template === null) {
      throw new ApiError(404, 'not_found', 'That template was not found.');
    }
    return template;
  }

  private async audit(
    state: AuthState & { organizationId: string },
    client: ClientInfo,
    action: string,
    targetId: string,
    meta?: Record<string, string>,
  ) {
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action,
      targetType: 'template',
      targetId,
      ip: client.ip,
      meta,
    });
  }
}

function fields(input: TemplateInput) {
  const samples = input.samples ?? {};
  return {
    name:
      input.name === undefined || input.name.trim() === ''
        ? nameFromBody(input.body)
        : input.name.trim(),
    category: input.category,
    language: input.language,
    body: input.body,
    variables: samples,
    status: 'DRAFT' as const,
  };
}

function presentTemplate(template: TemplateRow) {
  const samples = sampleMap(template.variables);
  return {
    id: template.id,
    shortId: template.id.slice(0, 8),
    name: template.name,
    category: template.category,
    language: template.language,
    body: template.body,
    samples,
    variables: templateVariables(template.body),
    status: template.status,
    rejectionReason: template.rejectionReason,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

function sampleMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const samples: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') {
      samples[key] = item;
    }
  }
  return samples;
}

function summarize(
  messages: readonly { status: string; createdAt: Date }[],
  start: number,
  days: number,
) {
  const points = Array.from({ length: days }, (_unused, index) => ({
    date: new Date(start + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    sent: 0,
    delivered: 0,
    failed: 0,
  }));
  const byDate = new Map(points.map((point) => [point.date, point]));
  for (const message of messages) {
    const point = byDate.get(message.createdAt.toISOString().slice(0, 10));
    if (point === undefined) {
      continue;
    }
    if (message.status === 'FAILED') {
      point.failed += 1;
    }
    if (
      message.status === 'SENT' ||
      message.status === 'DELIVERED' ||
      message.status === 'UNDELIVERED' ||
      message.status === 'EXPIRED'
    ) {
      point.sent += 1;
    }
    if (message.status === 'DELIVERED') {
      point.delivered += 1;
    }
  }
  return {
    sent: points.reduce((sum, point) => sum + point.sent, 0),
    delivered: points.reduce((sum, point) => sum + point.delivered, 0),
    failed: points.reduce((sum, point) => sum + point.failed, 0),
    points,
  };
}
