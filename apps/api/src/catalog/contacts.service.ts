import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@smsvio/db';
import { maskPhone, parseCsv, smsErrorMessage } from '@smsvio/shared';
import { normalizePhone } from '@smsvio/shared/phone';
import { PRISMA } from '@smsvio/server';

import type { AuthState } from '../accounts/support.js';
import { assertCapability, writeAudit } from '../accounts/support.js';
import { ApiError } from '../http/api-error.js';
import type { ClientInfo } from '../http/client.js';

interface ContactQuery {
  readonly q?: string;
  readonly country?: string;
  readonly optedOut?: 'yes' | 'no';
  readonly page: number;
  readonly pageSize: number;
  readonly sort: 'createdAt' | 'name' | 'phone';
  readonly direction: 'asc' | 'desc';
}

interface ImportInput {
  readonly csv: string;
  readonly hasHeader: boolean;
  readonly phoneColumn: number;
  readonly nameColumn: number | null;
  readonly countryColumn: number | null;
}

@Injectable()
export class ContactService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(state: AuthState, query: ContactQuery) {
    assertCapability(state, 'view');
    const where = {
      organizationId: state.organizationId,
      ...(query.country === undefined ? {} : { countryCode: query.country }),
      ...(query.optedOut === undefined ? {} : { optedOut: query.optedOut === 'yes' }),
      ...(query.q === undefined
        ? {}
        : {
            OR: [
              { phoneE164: { contains: query.q } },
              { name: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }),
    };
    const orderBy =
      query.sort === 'phone'
        ? { phoneE164: query.direction }
        : query.sort === 'name'
          ? { name: query.direction }
          : { createdAt: query.direction };
    const [total, rows] = await Promise.all([
      this.prisma.contact.count({ where }),
      this.prisma.contact.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: rows.map(presentContact),
    };
  }

  async get(state: AuthState, id: string) {
    assertCapability(state, 'view');
    const contact = await this.find(state.organizationId, id);
    const messages = await this.prisma.message.findMany({
      where: { organizationId: state.organizationId, to: contact.phoneE164 },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        status: true,
        body: true,
        direction: true,
        createdAt: true,
        fromSender: true,
      },
    });
    return {
      ...presentContact(contact),
      messages: messages.map((message) => ({
        id: message.id,
        status: message.status.toLowerCase(),
        body: message.body,
        direction: message.direction,
        from: message.fromSender,
        createdAt: message.createdAt.toISOString(),
      })),
    };
  }

  async create(
    state: AuthState,
    input: { phone: string; country?: string; name?: string },
    client: ClientInfo,
  ) {
    assertCapability(state, 'messaging');
    const phone = requirePhone(input.phone, input.country);
    try {
      const contact = await this.prisma.contact.create({
        data: {
          organizationId: state.organizationId,
          phoneE164: phone.e164,
          countryCode: phone.countryCode,
          name: blankToNull(input.name),
          attributes: {},
        },
      });
      await writeAudit(this.prisma, {
        organizationId: state.organizationId,
        actorUserId: state.userId,
        action: 'contact.created',
        targetType: 'contact',
        targetId: contact.id,
        ip: client.ip,
        meta: { phone: maskPhone(phone.e164) },
      });
      return presentContact(contact);
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new ApiError(409, 'duplicate_contact', 'That number is already a contact.');
      }
      throw error;
    }
  }

  async import(state: AuthState, input: ImportInput, client: ClientInfo) {
    assertCapability(state, 'messaging');
    const parsed = parseCsv(input.csv);
    if (!parsed.ok) {
      throw new ApiError(400, 'validation_error', parsed.message, { csv: parsed.message });
    }
    const source = input.hasHeader ? parsed.rows.slice(1) : parsed.rows;
    const header = input.hasHeader ? parsed.rows[0] : undefined;
    const rejected: { line: number; phone: string; reason: string }[] = [];
    const accepted: {
      phoneE164: string;
      countryCode: string;
      name: string | null;
      attributes: Record<string, string>;
    }[] = [];
    const seen = new Set<string>();
    source.forEach((row, index) => {
      const line = input.hasHeader ? index + 2 : index + 1;
      const rawPhone = cell(row, input.phoneColumn);
      const country = input.countryColumn === null ? undefined : cell(row, input.countryColumn);
      const result = normalizePhone(rawPhone, country === '' ? undefined : country);
      if (!result.ok) {
        rejected.push({ line, phone: rawPhone, reason: smsErrorMessage(result.code) });
        return;
      }
      if (seen.has(result.phone.e164)) {
        rejected.push({ line, phone: result.phone.e164, reason: 'Duplicate in this file.' });
        return;
      }
      seen.add(result.phone.e164);
      accepted.push({
        phoneE164: result.phone.e164,
        countryCode: result.phone.countryCode,
        name: input.nameColumn === null ? null : blankToNull(cell(row, input.nameColumn)),
        attributes: attributesFrom(header, row, input),
      });
    });
    const existingPhones = new Set<string>();
    if (accepted.length > 0) {
      const existing = await this.prisma.contact.findMany({
        where: {
          organizationId: state.organizationId,
          phoneE164: { in: accepted.map((row) => row.phoneE164) },
        },
        select: { phoneE164: true },
      });
      for (const row of existing) {
        existingPhones.add(row.phoneE164);
      }
    }
    let created = 0;
    for (const row of accepted) {
      if (existingPhones.has(row.phoneE164)) {
        rejected.push({ line: 0, phone: row.phoneE164, reason: 'Already in your contacts.' });
        continue;
      }
      try {
        await this.prisma.contact.create({
          data: { organizationId: state.organizationId, ...row },
        });
        created += 1;
      } catch (error) {
        if (!isUniqueConflict(error)) {
          throw error;
        }
        rejected.push({ line: 0, phone: row.phoneE164, reason: 'Already in your contacts.' });
      }
    }
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'contact.imported',
      targetType: 'contact',
      ip: client.ip,
      meta: { created, rejected: rejected.length },
    });
    return { created, rejected, rejectCsv: toRejectCsv(rejected) };
  }

  async remove(state: AuthState, id: string, client: ClientInfo) {
    assertCapability(state, 'messaging');
    const contact = await this.find(state.organizationId, id);
    await this.prisma.contact.delete({ where: { id: contact.id } });
    await writeAudit(this.prisma, {
      organizationId: state.organizationId,
      actorUserId: state.userId,
      action: 'contact.deleted',
      targetType: 'contact',
      targetId: contact.id,
      ip: client.ip,
      meta: { phone: maskPhone(contact.phoneE164) },
    });
    return { message: 'Contact deleted.' };
  }

  private async find(organizationId: string, id: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id, organizationId } });
    if (contact === null) {
      throw new ApiError(404, 'not_found', 'That contact was not found.');
    }
    return contact;
  }
}

function presentContact(contact: {
  id: string;
  phoneE164: string;
  countryCode: string;
  name: string | null;
  optedOut: boolean;
  attributes: unknown;
  createdAt: Date;
}) {
  return {
    id: contact.id,
    shortId: contact.id.slice(0, 8),
    phoneE164: contact.phoneE164,
    countryCode: contact.countryCode,
    name: contact.name,
    optedOut: contact.optedOut,
    attributes: attributesRecord(contact.attributes),
    createdAt: contact.createdAt.toISOString(),
  };
}

function requirePhone(phone: string, country: string | undefined) {
  const parsed = normalizePhone(phone, country);
  if (!parsed.ok) {
    throw new ApiError(400, parsed.code, smsErrorMessage(parsed.code), {
      phone: smsErrorMessage(parsed.code),
    });
  }
  return parsed.phone;
}

function blankToNull(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function cell(row: readonly string[], index: number): string {
  return row[index]?.trim() ?? '';
}

function attributesFrom(
  header: readonly string[] | undefined,
  row: readonly string[],
  input: ImportInput,
): Record<string, string> {
  if (header === undefined) {
    return {};
  }
  const used = new Set(
    [input.phoneColumn, input.nameColumn, input.countryColumn].filter((column) => column !== null),
  );
  const attributes: Record<string, string> = {};
  header.forEach((label, index) => {
    if (used.has(index)) {
      return;
    }
    const key = label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    const value = cell(row, index);
    if (key !== '' && value !== '') {
      attributes[key] = value.slice(0, 200);
    }
  });
  return attributes;
}

function attributesRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const attributes: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') {
      attributes[key] = item;
    }
  }
  return attributes;
}

function toRejectCsv(rows: readonly { line: number; phone: string; reason: string }[]): string {
  const lines = ['line,phone,reason'];
  for (const row of rows) {
    lines.push(`${String(row.line)},${csvCell(row.phone)},${csvCell(row.reason)}`);
  }
  return lines.join('\n');
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
