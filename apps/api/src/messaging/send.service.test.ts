import { randomUUID } from 'node:crypto';

import type { MembershipRole } from '@smsvio/shared';
import { describe, expect, it } from 'vitest';

import type { FastifyRequest } from 'fastify';

import type { AuthState } from '../accounts/support.js';
import { createMemoryDb } from '../memory-db.js';
import { MessagesController } from './messages.controller.js';
import { MessageQueryService } from './messages.service.js';
import { PricingService } from './pricing.service.js';
import { SendService } from './send.service.js';

function state(userId: string, organizationId: string): AuthState {
  return {
    userId,
    sessionId: randomUUID(),
    organizationId,
    role: 'OWNER' satisfies MembershipRole,
    body: { user: { isPlatformAdmin: false } },
  } as AuthState;
}

function redis() {
  const values = new Map<string, string>();
  const lists = new Map<string, string[]>();
  return {
    values,
    lists,
    incr: (key: string) => {
      const next = Number(values.get(key) ?? '0') + 1;
      values.set(key, String(next));
      return Promise.resolve(next);
    },
    expire: () => Promise.resolve(1),
    lpush: (key: string, value: string) => {
      const list = lists.get(key) ?? [];
      list.unshift(value);
      lists.set(key, list);
      return Promise.resolve(list.length);
    },
  };
}

describe('send service', () => {
  it('reserves the quoted price once and rejects a send the organization cannot make', async () => {
    const db = createMemoryDb();
    const cache = redis();
    const send = new SendService(db as never, cache as never, new PricingService(db as never));
    const user = await db.user.create({
      data: { email: 'owner@smsvio.test', name: 'Owner', passwordHash: 'x' },
    });
    const organization = await db.organization.create({
      data: { name: 'Senders', status: 'ACTIVE' },
    });
    const auth = state(user.id, organization.id);
    await db.country.create({
      data: {
        iso2: 'DE',
        name: 'Germany',
        dialCode: '49',
        alphaSenderAllowed: true,
        registrationRequired: false,
      },
    });
    await db.platformSetting.create({
      data: {
        id: 'platform',
        defaultDailySpendCapMicros: 20_000_000n,
        sharedSender: '12025550199',
      },
    });
    await db.provider.create({
      data: {
        code: 'mock',
        type: 'MOCK',
        status: 'ACTIVE',
        maxTps: 100,
        markupPercent: 50,
        configEnc: null,
        callbackSecretHash: null,
      },
    });
    const provider = [...(await db.provider.findMany())][0];
    if (provider === undefined) {
      throw new Error('missing provider');
    }
    await db.route.create({
      data: {
        countryIso2: 'DE',
        mccmnc: null,
        providerId: provider.id,
        priority: 100,
        weight: 1,
        costMicros: 10_000n,
        markupPercent: null,
        enabled: true,
      },
    });
    await db.orgCountry.create({
      data: {
        organizationId: organization.id,
        countryIso2: 'DE',
        senderIdId: null,
        registrationComplete: true,
      },
    });
    await db.orgBalance.create({
      data: { organizationId: organization.id, availableMicros: 100_000n, heldMicros: 0n },
    });
    const template = await db.template.create({
      data: {
        organizationId: organization.id,
        createdById: user.id,
        name: 'Hello',
        category: 'UTILITY',
        language: 'en',
        body: 'Hello {{name}}',
        variables: ['name'],
        status: 'APPROVED',
      },
    });
    const body = { templateId: template.id, to: '+4915123456789', variables: { name: 'Ada' } };

    await expect(send.send(auth, { ...body, to: 'not-a-phone' })).rejects.toMatchObject({
      code: 'invalid_number',
    });
    const queued = await send.send(auth, body);
    expect(queued.status).toBe('queued');
    expect(queued.price.micros).toBe('15000');
    expect(cache.lists.get('smsvio:q:sms.send')).toEqual([queued.id]);
    const balance = await db.orgBalance.findUnique({ where: { organizationId: organization.id } });
    expect(balance?.availableMicros).toBe(85_000n);
    expect(balance?.heldMicros).toBe(15_000n);

    const again = await send.send(auth, { ...body, clientRef: 'same' });
    const replay = await send.send(auth, { ...body, clientRef: 'same' });
    expect(replay.id).toBe(again.id);
    const after = await db.orgBalance.findUnique({ where: { organizationId: organization.id } });
    expect(after?.heldMicros).toBe(30_000n);

    await db.contact.create({
      data: {
        organizationId: organization.id,
        phoneE164: '+4915123456789',
        countryCode: 'DE',
        name: null,
        attributes: {},
        optedOut: true,
      },
    });
    await expect(send.send(auth, { ...body, clientRef: 'out' })).rejects.toMatchObject({
      code: 'recipient_opted_out',
    });

    await db.organization.update({ where: { id: organization.id }, data: { status: 'SUSPENDED' } });
    await expect(send.send(auth, { templateId: template.id, to: body.to })).rejects.toMatchObject({
      code: 'organization_suspended',
    });
    await db.organization.update({
      where: { id: organization.id },
      data: { status: 'PENDING_VERIFICATION', dailySpendCapMicros: 0n },
    });
    await expect(send.send(auth, { templateId: template.id, to: body.to })).rejects.toMatchObject({
      code: 'organization_not_verified',
    });
    await db.user.update({
      where: { id: user.id },
      data: { accountPhoneE164: '+4915112345678', accountPhoneVerifiedAt: new Date() },
    });
    await db.organization.update({
      where: { id: organization.id },
      data: { dailySpendCapMicros: 10_000n },
    });
    await expect(
      send.send(auth, {
        templateId: template.id,
        to: '+4915112345678',
        variables: { name: 'Ada' },
      }),
    ).rejects.toMatchObject({ code: 'spend_cap_reached' });
  });

  it('rejects a destination, template, sender, or balance the organization cannot use', async () => {
    const db = createMemoryDb();
    const cache = redis();
    const pricing = new PricingService(db as never);
    const send = new SendService(db as never, cache as never, pricing);
    const user = await db.user.create({
      data: { email: 'owner@smsvio.test', name: 'Owner', passwordHash: 'x' },
    });
    const organization = await db.organization.create({
      data: { name: 'Limited', status: 'ACTIVE' },
    });
    const auth = state(user.id, organization.id);
    await db.country.create({
      data: {
        iso2: 'DE',
        name: 'Germany',
        dialCode: '49',
        alphaSenderAllowed: true,
        registrationRequired: false,
      },
    });
    await db.country.create({
      data: {
        iso2: 'US',
        name: 'United States',
        dialCode: '1',
        alphaSenderAllowed: false,
        registrationRequired: true,
      },
    });
    await db.platformSetting.create({
      data: {
        id: 'platform',
        defaultDailySpendCapMicros: 20_000_000n,
        sharedSender: '12025550199',
      },
    });
    const provider = await db.provider.create({
      data: {
        code: 'mock',
        type: 'MOCK',
        status: 'ACTIVE',
        maxTps: 100,
        markupPercent: 50,
        configEnc: null,
        callbackSecretHash: null,
      },
    });
    const route = await db.route.create({
      data: {
        countryIso2: 'DE',
        mccmnc: null,
        providerId: provider.id,
        priority: 100,
        weight: 1,
        costMicros: 10_000n,
        markupPercent: null,
        enabled: true,
      },
    });
    const germany = await db.orgCountry.create({
      data: {
        organizationId: organization.id,
        countryIso2: 'DE',
        senderIdId: null,
        registrationComplete: true,
      },
    });
    await db.orgBalance.create({
      data: { organizationId: organization.id, availableMicros: 1_000_000n, heldMicros: 0n },
    });
    const template = await db.template.create({
      data: {
        organizationId: organization.id,
        createdById: user.id,
        name: 'Hello',
        category: 'UTILITY',
        language: 'en',
        body: 'Hello {{name}}',
        variables: ['name'],
        status: 'APPROVED',
      },
    });
    const draft = await db.template.create({
      data: {
        organizationId: organization.id,
        createdById: user.id,
        name: 'Draft',
        category: 'UTILITY',
        language: 'en',
        body: 'A'.repeat(1700),
        variables: [],
        status: 'DRAFT',
      },
    });
    const input = { templateId: template.id, to: '+4915123456789', variables: { name: 'Ada' } };
    const preview = await send.preview(auth, input);
    expect(preview.price.micros).toBe('15000');
    await expect(send.send(auth, { templateId: template.id })).rejects.toMatchObject({
      code: 'invalid_number',
    });
    await expect(send.send(auth, { ...input, to: '+33612345678' })).rejects.toMatchObject({
      code: 'country_not_supported',
    });
    await expect(send.send(auth, { ...input, to: '+14155552671' })).rejects.toMatchObject({
      code: 'country_not_enabled',
    });
    await db.orgCountry.create({
      data: {
        organizationId: organization.id,
        countryIso2: 'US',
        senderIdId: null,
        registrationComplete: false,
      },
    });
    await expect(send.send(auth, { ...input, to: '+14155552671' })).rejects.toMatchObject({
      code: 'registration_required',
    });
    await db.orgCountry.delete({ where: { id: germany.id } });
    await expect(send.send(auth, input)).rejects.toMatchObject({ code: 'country_not_enabled' });
    await db.orgCountry.create({
      data: {
        organizationId: organization.id,
        countryIso2: 'DE',
        senderIdId: null,
        registrationComplete: true,
      },
    });
    await expect(send.send(auth, { ...input, templateId: draft.id })).rejects.toMatchObject({
      code: 'template_not_approved',
    });
    await expect(send.send(auth, { ...input, variables: {} })).rejects.toMatchObject({
      code: 'missing_variable',
    });
    await expect(
      send.send(auth, { ...input, templateId: draft.id, variables: {} }),
    ).rejects.toMatchObject({ code: 'template_not_approved' });
    const long = await db.template.create({
      data: {
        organizationId: organization.id,
        createdById: user.id,
        name: 'Long',
        category: 'UTILITY',
        language: 'en',
        body: 'A'.repeat(1700),
        variables: [],
        status: 'APPROVED',
      },
    });
    await expect(
      send.send(auth, { ...input, templateId: long.id, variables: {} }),
    ).rejects.toMatchObject({
      code: 'message_too_long',
    });
    await expect(send.send(auth, { ...input, senderId: randomUUID() })).rejects.toMatchObject({
      code: 'sender_not_approved',
    });
    const bad = await db.senderId.create({
      data: {
        organizationId: organization.id,
        value: 'AB',
        type: 'ALPHANUMERIC',
        status: 'APPROVED',
        useCase: 'alerts',
      },
    });
    await expect(send.send(auth, { ...input, senderId: bad.id })).rejects.toMatchObject({
      code: 'invalid_sender',
    });
    await db.platformSetting.update({ where: { id: 'platform' }, data: { sharedSender: '' } });
    await expect(send.send(auth, { ...input, senderId: null })).rejects.toMatchObject({
      code: 'invalid_sender',
    });
    await db.platformSetting.update({
      where: { id: 'platform' },
      data: { sharedSender: '12025550199' },
    });
    await db.route.update({ where: { id: route.id }, data: { enabled: false } });
    await expect(send.send(auth, input)).rejects.toMatchObject({ code: 'no_route' });
    await db.route.update({ where: { id: route.id }, data: { enabled: true } });
    await expect(
      send.send(auth, { templateId: template.id, contactId: randomUUID() }),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    const contact = await db.contact.create({
      data: {
        organizationId: organization.id,
        phoneE164: '+4915123456789',
        countryCode: 'DE',
        name: null,
        attributes: {},
        optedOut: false,
      },
    });
    const queued = await send.send(auth, {
      templateId: template.id,
      contactId: contact.id,
      variables: { name: 'Ada' },
    });
    expect(queued.to).toBe('+4915123456789');
    await db.message.update({
      where: { id: queued.id },
      data: { status: 'FAILED', priceMicros: null },
    });
    await db.message.create({
      data: {
        organizationId: organization.id,
        direction: 'OUTBOUND',
        to: '+4915123456789',
        body: 'Rejected',
        status: 'REJECTED',
        priceMicros: 15_000n,
      },
    });
    const empty = state(user.id, randomUUID());
    await expect(send.send(empty, input)).rejects.toMatchObject({ code: 'internal_error' });
    const viewer = state(user.id, organization.id);
    Object.assign(viewer, { role: 'VIEWER' });
    await expect(send.send(viewer, input)).rejects.toMatchObject({ code: 'forbidden' });
    const controller = new MessagesController(send, new MessageQueryService(db as never));
    const request = {
      auth,
      headers: { 'idempotency-key': ['again'] },
    } as unknown as FastifyRequest;
    const accepted = await controller.send(request, input);
    expect(accepted.to).toBe('+4915123456789');
    await expect(
      Promise.resolve().then(() =>
        controller.send(
          { auth, headers: { 'idempotency-key': 'x'.repeat(81) } } as unknown as FastifyRequest,
          input,
        ),
      ),
    ).rejects.toMatchObject({ code: 'validation_error' });
    const blank = await controller.send(
      { auth, headers: { 'idempotency-key': '  ' } } as unknown as FastifyRequest,
      { ...input, clientRef: 'blank-key' },
    );
    expect(blank.to).toBe('+4915123456789');
    await expect(
      Promise.resolve().then(() =>
        controller.preview({ auth: undefined, headers: {} } as unknown as FastifyRequest, input),
      ),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    const listed = await controller.list({ auth, headers: {} } as unknown as FastifyRequest, {
      page: '1',
      pageSize: '10',
    });
    expect(listed.total).toBeGreaterThan(0);
    let limited = false;
    for (let count = 0; count < 45 && !limited; count += 1) {
      try {
        await send.send(auth, { ...input, clientRef: `n-${String(count)}` });
      } catch (error) {
        expect(error).toMatchObject({ code: 'rate_limited' });
        limited = true;
      }
    }
    expect(limited).toBe(true);
  });
});
