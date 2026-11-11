import { randomUUID } from 'node:crypto';

import { Prisma } from '@smsvio/db';
import type { MembershipRole } from '@smsvio/shared';
import { describe, expect, it } from 'vitest';

import type { AuthState } from '../accounts/support.js';
import { ApiError } from '../http/api-error.js';
import { createMemoryDb } from '../memory-db.js';
import { testEnv } from '../testing.js';
import { LedgerService } from './ledger.service.js';
import { OrganizationAdminService } from './organization-admin.service.js';
import { PricingService } from './pricing.service.js';
import { isUniqueViolation, requireUsd } from './present.js';
import { ProviderAdminService } from './provider-admin.service.js';
import { RateAdminService } from './rate-admin.service.js';
import { SenderService } from './senders.service.js';

const client = { ip: null, userAgent: null };

function adminState(organizationId: string): AuthState {
  return {
    userId: randomUUID(),
    sessionId: randomUUID(),
    organizationId,
    role: 'OWNER' satisfies MembershipRole,
    body: { user: { isPlatformAdmin: true } },
  } as AuthState;
}

describe('admin pricing services', () => {
  it('rejects bad input and keeps computed, manual, and per-customer prices apart', async () => {
    const db = createMemoryDb();
    const ledger = new LedgerService(db as never);
    const pricing = new PricingService(db as never);
    const providers = new ProviderAdminService(db as never, testEnv, pricing);
    const rates = new RateAdminService(db as never, pricing);
    const organizations = new OrganizationAdminService(db as never, ledger);
    const senders = new SenderService(db as never, pricing);
    const organization = await db.organization.create({ data: { name: 'Prices' } });
    const state = adminState(organization.id);
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
    await db.country.create({
      data: {
        iso2: 'XX',
        name: 'Disabled',
        dialCode: '0',
        alphaSenderAllowed: true,
        registrationRequired: false,
        enabled: false,
      },
    });

    expect(requireUsd('0', 'amount', true)).toBe(0n);
    expect(() => requireUsd('0', 'amount', false)).toThrow(ApiError);
    expect(() => requireUsd('nope', 'amount', true)).toThrow(ApiError);
    expect(isUniqueViolation(new Error('no'))).toBe(false);
    expect(
      isUniqueViolation(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
      ),
    ).toBe(true);
    expect(
      isUniqueViolation(
        new Prisma.PrismaClientKnownRequestError('other', { code: 'P2003', clientVersion: 'test' }),
      ),
    ).toBe(false);

    const created = await providers.create(
      state,
      { code: 'mock', type: 'MOCK', markupPercent: 50, maxTps: 10, config: '{"systemId":"a"}' },
      client,
    );
    expect(created.callbackSecret).toEqual(expect.any(String));
    await expect(
      providers.create(
        state,
        { code: 'mock', type: 'MOCK', markupPercent: 50, maxTps: 10 },
        client,
      ),
    ).rejects.toMatchObject({ code: 'validation_error' });
    await expect(
      providers.create(
        state,
        { code: 'badjson', type: 'HTTP', markupPercent: 10, maxTps: 1, config: '[' },
        client,
      ),
    ).rejects.toMatchObject({ fields: { config: 'Credentials have to be a JSON object.' } });
    await expect(
      providers.create(
        state,
        { code: 'badshape', type: 'HTTP', markupPercent: 10, maxTps: 1, config: '[]' },
        client,
      ),
    ).rejects.toMatchObject({ fields: { config: 'Credentials have to be a JSON object.' } });
    const http = await providers.create(
      state,
      { code: 'http', type: 'HTTP', markupPercent: 10, maxTps: 1, config: '' },
      client,
    );
    const listed = await providers.providers(state);
    expect(listed.items.map((item) => item.code)).toEqual(['http', 'mock']);
    const rotated = await providers.update(
      state,
      created.id,
      { markupPercent: 100, maxTps: 20, status: 'ACTIVE', rotateSecret: true, config: '' },
      client,
    );
    expect(rotated.callbackSecret).toEqual(expect.any(String));
    await expect(
      providers.update(
        state,
        randomUUID(),
        { markupPercent: 1, maxTps: 1, status: 'DISABLED' },
        client,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(providers.health(state, randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(providers.health(state, http.id)).resolves.toMatchObject({ ok: false });

    const route = await providers.createRoute(
      state,
      {
        countryIso2: 'DE',
        mccmnc: null,
        providerId: created.id,
        priority: 10,
        weight: 1,
        cost: '0.0100',
        markupPercent: null,
        enabled: true,
      },
      client,
    );
    await providers.createRoute(
      state,
      {
        countryIso2: 'DE',
        mccmnc: '26201',
        providerId: created.id,
        priority: 5,
        weight: 1,
        cost: '0.0200',
        markupPercent: 25,
        enabled: true,
      },
      client,
    );
    await expect(
      providers.createRoute(
        state,
        {
          countryIso2: 'DE',
          mccmnc: null,
          providerId: created.id,
          priority: 10,
          weight: 1,
          cost: '0.0100',
          markupPercent: null,
          enabled: true,
        },
        client,
      ),
    ).rejects.toMatchObject({
      fields: { countryIso2: 'That provider already has a route for this destination.' },
    });
    await expect(
      providers.createRoute(
        state,
        {
          countryIso2: 'XX',
          mccmnc: null,
          providerId: created.id,
          priority: 1,
          weight: 1,
          cost: '0.0100',
          markupPercent: null,
          enabled: true,
        },
        client,
      ),
    ).rejects.toMatchObject({ fields: { countryIso2: 'Choose an enabled country.' } });
    await expect(
      providers.createRoute(
        state,
        {
          countryIso2: 'DE',
          mccmnc: null,
          providerId: randomUUID(),
          priority: 1,
          weight: 1,
          cost: '0.0100',
          markupPercent: null,
          enabled: true,
        },
        client,
      ),
    ).rejects.toMatchObject({ fields: { providerId: 'Choose a provider.' } });
    await expect(
      providers.updateRoute(
        state,
        randomUUID(),
        { priority: 1, weight: 1, cost: '0', markupPercent: null, enabled: false },
        client,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      providers.updateRoute(
        state,
        route.id,
        { priority: 3, weight: 2, cost: '0', markupPercent: 10, enabled: true },
        client,
      ),
    ).resolves.toMatchObject({ message: 'Route updated. Customer prices were recalculated.' });
    await expect(providers.deleteRoute(state, randomUUID(), client)).rejects.toMatchObject({
      status: 404,
    });
    const removable = await providers.createRoute(
      state,
      {
        countryIso2: 'US',
        mccmnc: null,
        providerId: http.id,
        priority: 50,
        weight: 1,
        cost: '0.0100',
        markupPercent: null,
        enabled: true,
      },
      client,
    );
    await providers.update(
      state,
      http.id,
      { markupPercent: 10, maxTps: 1, status: 'DISABLED' },
      client,
    );
    await expect(providers.deleteRoute(state, removable.id, client)).resolves.toMatchObject({
      message: 'Route deleted. Customer prices were recalculated.',
    });

    const described = await providers.routes(state, {
      q: 'germany',
      page: 1,
      pageSize: 25,
      country: 'DE',
    });
    expect(described.items.some((item) => item.markupSource === 'route')).toBe(true);
    await db.rate.create({
      data: { countryIso2: 'XX', mccmnc: '00101', priceMicros: 1n, effectiveFrom: new Date() },
    });
    const table = await rates.list(state, { q: 'DE', page: 1, pageSize: 25 });
    expect(table.items[0]?.source).toBe('computed');
    await expect(
      rates.list(state, { page: 1, pageSize: 25, organizationId: randomUUID() }),
    ).rejects.toMatchObject({
      status: 404,
    });
    await expect(rates.preview(state, 'nope')).resolves.toMatchObject({ ok: false });
    await expect(rates.commit(state, 'nope', client)).rejects.toMatchObject({
      code: 'validation_error',
    });
    await expect(
      rates.preview(state, 'country,network,price\nZZ,,0.0100\n'),
    ).resolves.toMatchObject({
      ok: false,
    });
    await rates.commit(state, 'country,network,price\nDE,,0.0500\n', client);
    await rates.setOrgRate(
      state,
      { organizationId: organization.id, countryIso2: 'DE', mccmnc: '26201', price: '0.0300' },
      client,
    );
    await expect(
      rates.setOrgRate(
        state,
        { organizationId: randomUUID(), countryIso2: 'DE', mccmnc: null, price: '0.0100' },
        client,
      ),
    ).rejects.toMatchObject({ code: 'validation_error' });
    const priced = await rates.list(state, {
      page: 1,
      pageSize: 25,
      organizationId: organization.id,
      q: '26201',
    });
    expect(priced.items[0]?.source).toBe('per-customer');
    await rates.clear(
      state,
      { countryIso2: 'DE', mccmnc: '26201', organizationId: organization.id },
      client,
    );
    await rates.clear(state, { countryIso2: 'DE', mccmnc: null, organizationId: null }, client);
    const restored = await rates.list(state, { page: 1, pageSize: 25, q: 'DE' });
    expect(restored.items.some((item) => item.mccmnc === null && item.source === 'computed')).toBe(
      true,
    );

    await expect(
      organizations.setStatus(state, randomUUID(), 'SUSPENDED', client),
    ).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      organizations.setSpendCap(state, randomUUID(), null, client),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      organizations.setSpendCap(state, organization.id, null, client),
    ).resolves.toMatchObject({
      message: 'This organization uses the platform spend cap.',
    });
    await organizations.setSpendCap(state, organization.id, '0', client);
    await expect(organizations.settings(state)).resolves.toMatchObject({
      defaultDailySpendCap: { display: '20.00' },
    });
    await organizations.setPlatformCap(state, '0', client);
    const directory = await organizations.countries(state);
    expect(directory.items.map((item) => item.iso2)).toEqual(['DE', 'US']);

    const added = await senders.addCountry(state, { countryIso2: 'DE', senderId: null }, client);
    await expect(
      senders.addCountry(state, { countryIso2: 'XX', senderId: null }, client),
    ).rejects.toMatchObject({
      code: 'country_not_supported',
    });
    await expect(
      senders.addCountry(state, { countryIso2: 'US', senderId: randomUUID() }, client),
    ).rejects.toMatchObject({ code: 'sender_not_approved' });
    await expect(senders.removeCountry(state, randomUUID(), client)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      senders.requestSender(
        state,
        {
          type: 'ALPHANUMERIC',
          value: '12',
          useCase: 'Order updates for customers.',
          countries: ['DE'],
        },
        client,
      ),
    ).rejects.toMatchObject({ code: 'invalid_sender' });
    await expect(
      senders.requestSender(
        state,
        {
          type: 'LONG_CODE',
          value: '12025550100',
          useCase: 'Order updates for customers.',
          countries: ['NO'],
        },
        client,
      ),
    ).rejects.toMatchObject({ code: 'country_not_supported' });
    await expect(
      senders.requestSender(
        state,
        {
          type: 'ALPHANUMERIC',
          value: 'NOTIFY',
          useCase: 'Order updates for customers.',
          countries: ['US'],
        },
        client,
      ),
    ).rejects.toMatchObject({ code: 'invalid_sender' });
    const requested = await senders.requestSender(
      state,
      {
        type: 'LONG_CODE',
        value: '12025550100',
        useCase: 'Order updates for customers.',
        countries: ['DE', 'DE'],
      },
      client,
    );
    await expect(
      senders.requestSender(
        state,
        {
          type: 'LONG_CODE',
          value: '12025550100',
          useCase: 'Order updates for customers.',
          countries: ['DE'],
        },
        client,
      ),
    ).rejects.toMatchObject({ code: 'sender_exists' });
    await expect(senders.getSender(state, randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(senders.getSender(state, requested.id)).resolves.toMatchObject({
      value: '12025550100',
    });
    await expect(senders.removeCountry(state, added.id, client)).resolves.toMatchObject({
      message: 'Country removed.',
    });

    await expect(
      ledger.reserve(organization.id, 0n, { type: 'message', id: 'zero' }, 'Zero'),
    ).rejects.toMatchObject({ status: 400 });
    await ledger.adjust(
      state.userId,
      organization.id,
      { direction: 'credit', amount: 2_000n, reason: 'Credit' },
      client,
    );
    await ledger.reserve(organization.id, 500n, { type: 'message', id: 'held' }, 'Hold');
    await ledger.charge(organization.id, 500n, { type: 'message', id: 'held' }, 'Charge');
    await expect(
      ledger.reserve(organization.id, 500n, { type: 'message', id: 'held' }, 'Again'),
    ).rejects.toMatchObject({ code: 'balance_settled' });
    await ledger.reserve(organization.id, 500n, { type: 'message', id: 'other' }, 'Hold');
    await expect(
      ledger.charge(organization.id, 400n, { type: 'message', id: 'other' }, 'Wrong'),
    ).rejects.toMatchObject({ code: 'hold_missing' });
  });
});
