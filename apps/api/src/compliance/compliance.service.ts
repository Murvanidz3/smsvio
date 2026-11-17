import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@smsvio/db';
import {
  DEFAULT_REPLIES,
  normalizeKeyword,
  type AutoReplyCategory,
} from '@smsvio/shared/compliance';
import { PRISMA } from '@smsvio/server';

import type { AuthState } from '../accounts/support.js';
import { assertCapability, writeAudit } from '../accounts/support.js';
import type { ClientInfo } from '../http/client.js';
import { ApiError } from '../http/api-error.js';
import { validation } from '../messaging/present.js';
import { API_ENV } from '../config.js';
import type { ApiEnv } from '../env.js';
import { decryptString, encryptString } from '../security/encryption.js';

const MAX_DOCUMENT_BYTES = 512 * 1024;

@Injectable()
export class ComplianceService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async view(state: AuthState) {
    assertCapability(state, 'compliance');
    const organizationId = state.organizationId;
    await this.ensureReplies(organizationId);
    const [organization, profile, useCases, documents, replies] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: organizationId } }),
      this.prisma.complianceProfile.findUnique({ where: { organizationId } }),
      this.prisma.useCase.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.complianceDocument.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.autoReply.findMany({ where: { organizationId }, orderBy: { category: 'asc' } }),
    ]);
    if (organization === null) {
      throw new ApiError(404, 'not_found', 'That organization does not exist.');
    }
    return {
      status: organization.status,
      profile:
        profile === null
          ? null
          : {
              legalName: profile.legalName,
              address: profile.address,
              website: profile.website ?? '',
              registrationNumber: profile.registrationNumber ?? '',
              registrationCountry: profile.registrationCountry,
              submittedAt: profile.submittedAt.toISOString(),
              reviewNote: profile.reviewNote ?? '',
            },
      useCases: useCases.map((row) => ({
        id: row.id,
        purpose: row.purpose,
        sample: row.sample,
        optIn: row.optIn,
        status: row.status,
        reviewNote: row.reviewNote ?? '',
      })),
      documents: documents.map((row) => ({
        id: row.id,
        country: row.countryIso2,
        kind: row.kind,
        filename: row.filename,
        contentType: row.contentType,
        createdAt: row.createdAt.toISOString(),
      })),
      replies: replies.map((row) => ({
        id: row.id,
        category: row.category,
        keywords: row.keywords,
        body: row.body,
        protected: row.protected,
      })),
    };
  }

  async submitBusiness(
    state: AuthState,
    input: {
      legalName: string;
      address: string;
      website?: string;
      registrationNumber?: string;
      registrationCountry: string;
    },
    client: ClientInfo,
  ) {
    assertCapability(state, 'compliance');
    const organizationId = state.organizationId;
    const existing = await this.prisma.complianceProfile.findUnique({ where: { organizationId } });
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    const waiting =
      existing !== null && (existing.reviewNote === null || existing.reviewNote === '');
    if (existing !== null && (organization?.status !== 'PENDING_VERIFICATION' || waiting)) {
      throw new ApiError(409, 'already_submitted', 'Business verification is already submitted.');
    }
    const fields = {
      legalName: input.legalName,
      address: input.address,
      website: blank(input.website),
      registrationNumber: blank(input.registrationNumber),
      registrationCountry: input.registrationCountry,
      reviewNote: null,
    };
    const profile = await this.prisma.complianceProfile.upsert({
      where: { organizationId },
      create: { organizationId, ...fields },
      update: { ...fields, submittedAt: new Date() },
    });
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { legalName: input.legalName },
    });
    await writeAudit(this.prisma, {
      organizationId,
      actorUserId: state.userId,
      action: 'compliance.submitted',
      targetType: 'organization',
      targetId: organizationId,
      ip: client.ip,
    });
    return { submittedAt: profile.submittedAt.toISOString() };
  }

  async addUseCase(
    state: AuthState,
    input: { purpose: string; sample: string; optIn: string },
    client: ClientInfo,
  ) {
    assertCapability(state, 'compliance');
    const created = await this.prisma.useCase.create({
      data: { organizationId: state.organizationId, ...input },
    });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'compliance.use_case',
      targetType: 'use_case',
      targetId: created.id,
      ip: client.ip,
    });
    return { id: created.id, status: created.status };
  }

  async addDocument(
    state: AuthState,
    input: {
      countryIso2: string;
      kind: string;
      filename: string;
      contentType: string;
      dataBase64: string;
    },
    client: ClientInfo,
  ) {
    assertCapability(state, 'compliance');
    const bytes = Buffer.from(input.dataBase64, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_DOCUMENT_BYTES) {
      throw validation({ dataBase64: 'Upload a file up to 512 KB.' });
    }
    if (!documentMatches(input.contentType, bytes)) {
      throw validation({ dataBase64: 'That file does not match its declared type.' });
    }
    const created = await this.prisma.complianceDocument.create({
      data: {
        organizationId: state.organizationId,
        countryIso2: input.countryIso2,
        kind: input.kind,
        filename: input.filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120),
        contentType: input.contentType,
        bytesEnc: encryptString(bytes.toString('base64'), this.env.APP_ENCRYPTION_KEY),
      },
    });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'compliance.document',
      targetType: 'document',
      targetId: created.id,
      ip: client.ip,
    });
    return { id: created.id };
  }

  async download(
    state: AuthState,
    id: string,
  ): Promise<{ filename: string; contentType: string; bytes: Buffer }> {
    assertCapability(state, 'compliance');
    const row = await this.prisma.complianceDocument.findFirst({
      where: { id, organizationId: state.organizationId },
    });
    if (row === null) {
      throw new ApiError(404, 'not_found', 'That document does not exist.');
    }
    return {
      filename: row.filename,
      contentType: row.contentType,
      bytes: Buffer.from(decryptString(row.bytesEnc, this.env.APP_ENCRYPTION_KEY), 'base64'),
    };
  }

  async saveReply(
    state: AuthState,
    input: { category: AutoReplyCategory; keywords: string[]; body: string },
    client: ClientInfo,
    id?: string,
  ) {
    assertCapability(state, 'compliance');
    const keywords = keywordsOf(input.keywords);
    await this.ensureReplies(state.organizationId);
    const current =
      id === undefined
        ? null
        : await this.prisma.autoReply.findMany({ where: { organizationId: state.organizationId } });
    const row = current?.find((item) => item.id === id) ?? null;
    if (id !== undefined && row === null) {
      throw new ApiError(404, 'not_found', 'That auto-reply does not exist.');
    }
    if (row?.protected === true && row.category !== input.category) {
      throw validation({ category: 'A protected auto-reply keeps its category.' });
    }
    if (row === null && input.category !== 'CUSTOM') {
      throw validation({ category: 'Add a custom keyword. The three defaults already exist.' });
    }
    const others = await this.prisma.autoReply.findMany({
      where: { organizationId: state.organizationId },
    });
    const taken = new Set(
      others
        .filter((item) => item.id !== id)
        .flatMap((item) => item.keywords.map((word) => word.toLowerCase())),
    );
    if (keywords.some((word) => taken.has(word))) {
      throw validation({ keywords: 'That keyword is already used.' });
    }
    const saved =
      row === null
        ? await this.prisma.autoReply.create({
            data: {
              organizationId: state.organizationId,
              category: 'CUSTOM',
              keywords,
              body: input.body,
              protected: false,
            },
          })
        : await this.prisma.autoReply.update({
            where: { id: row.id },
            data: { keywords, body: input.body },
          });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'compliance.auto_reply',
      targetType: 'auto_reply',
      targetId: saved.id,
      ip: client.ip,
    });
    return { id: saved.id };
  }

  async deleteReply(state: AuthState, id: string, client: ClientInfo) {
    assertCapability(state, 'compliance');
    const rows = await this.prisma.autoReply.findMany({
      where: { organizationId: state.organizationId },
    });
    const row = rows.find((item) => item.id === id);
    if (row === undefined) {
      throw new ApiError(404, 'not_found', 'That auto-reply does not exist.');
    }
    if (row.protected) {
      throw new ApiError(400, 'protected_reply', 'The default auto-replies cannot be deleted.');
    }
    await this.prisma.autoReply.delete({ where: { id } });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'compliance.auto_reply_deleted',
      targetType: 'auto_reply',
      targetId: id,
      ip: client.ip,
    });
    return { message: 'Auto-reply deleted.' };
  }

  private async ensureReplies(organizationId: string): Promise<void> {
    const existing = await this.prisma.autoReply.findMany({ where: { organizationId } });
    if (existing.length > 0) {
      return;
    }
    for (const reply of DEFAULT_REPLIES) {
      await this.prisma.autoReply.create({
        data: {
          organizationId,
          category: reply.category,
          keywords: [...reply.keywords],
          body: reply.body,
          protected: true,
        },
      });
    }
  }
}

export function documentMatches(contentType: string, bytes: Buffer): boolean {
  if (contentType === 'application/pdf') {
    return bytes.subarray(0, 4).toString('ascii') === '%PDF';
  }
  if (contentType === 'image/png') {
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (contentType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === 'image/webp') {
    return (
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return contentType === 'text/plain' && !bytes.includes(0);
}

function blank(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function keywordsOf(values: string[]): string[] {
  const keywords = values.map((value) => normalizeKeyword(value));
  if (keywords.some((value) => value === null)) {
    throw validation({ keywords: 'Use 2 to 32 letters or digits for each keyword.' });
  }
  return [...new Set(keywords.filter((value): value is string => value !== null))];
}
