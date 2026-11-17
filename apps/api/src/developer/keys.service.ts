import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@smsvio/db';
import { apiKeyLast4, apiKeyPrefix, createApiKey, maskApiKey } from '@smsvio/shared/developer';
import { PRISMA } from '@smsvio/server';

import type { AuthState } from '../accounts/support.js';
import { assertCapability, writeAudit } from '../accounts/support.js';
import type { ClientInfo } from '../http/client.js';
import { ApiError } from '../http/api-error.js';
import { hashToken } from '../security/tokens.js';

interface Page {
  readonly page: number;
  readonly pageSize: number;
}

@Injectable()
export class ApiKeyService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(state: AuthState, query: Page) {
    assertCapability(state, 'developer');
    const where = { organizationId: state.organizationId };
    const [total, rows] = await Promise.all([
      this.prisma.apiKey.count({ where }),
      this.prisma.apiKey.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      organizationId: state.organizationId,
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: rows.map(presentKey),
    };
  }

  async create(
    state: AuthState,
    input: { name: string; mode: 'LIVE' | 'TEST' },
    client: ClientInfo,
  ) {
    assertCapability(state, 'developer');
    const secret = createApiKey(input.mode);
    const row = await this.prisma.apiKey.create({
      data: {
        organizationId: state.organizationId,
        name: input.name,
        mode: input.mode,
        prefix: apiKeyPrefix(secret),
        keyHash: hashToken(secret),
        last4: apiKeyLast4(secret),
        createdById: state.userId,
      },
    });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'api_key.created',
      targetType: 'api_key',
      targetId: row.id,
      ip: client.ip,
      meta: { mode: row.mode, name: row.name },
    });
    return { ...presentKey(row), secret };
  }

  async update(
    state: AuthState,
    id: string,
    input: { name?: string; status?: 'ACTIVE' | 'DISABLED' },
    client: ClientInfo,
  ) {
    assertCapability(state, 'developer');
    await this.find(state.organizationId, id);
    const row = await this.prisma.apiKey.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.status === undefined ? {} : { status: input.status }),
      },
    });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'api_key.updated',
      targetType: 'api_key',
      targetId: row.id,
      ip: client.ip,
      meta: { status: row.status, name: row.name },
    });
    return presentKey(row);
  }

  async remove(state: AuthState, id: string, client: ClientInfo) {
    assertCapability(state, 'developer');
    await this.find(state.organizationId, id);
    await this.prisma.apiKey.delete({ where: { id } });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'api_key.deleted',
      targetType: 'api_key',
      targetId: id,
      ip: client.ip,
    });
    return { message: 'API key deleted.' };
  }

  private async find(organizationId: string, id: string) {
    const row = await this.prisma.apiKey.findUnique({ where: { id } });
    if (row?.organizationId !== organizationId) {
      throw new ApiError(404, 'not_found', 'That API key does not exist.');
    }
    return row;
  }
}

function presentKey(row: {
  id: string;
  name: string;
  mode: 'LIVE' | 'TEST';
  status: 'ACTIVE' | 'DISABLED';
  prefix: string;
  last4: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}) {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    status: row.status,
    masked: maskApiKey(row.prefix, row.last4),
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}
