import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@smsvio/db';
import {
  currentFixedPrice,
  effectiveMarkup,
  marginMicros,
  quoteFromCost,
  resolveCustomerPrice,
  selectPrimaryRoute,
  type PriceSource,
} from '@smsvio/shared/billing';
import { PRISMA } from '@smsvio/server';

import { presentMoney } from './present.js';

interface Destination {
  readonly countryIso2: string;
  readonly mccmnc: string | null;
}

interface Quote {
  readonly micros: bigint;
  readonly source: PriceSource;
}

@Injectable()
export class PricingService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async quoteOne(
    organizationId: string,
    countryIso2: string,
    mccmnc: string | null,
  ): Promise<Quote | null> {
    const graph = await this.graph();
    const orgRates = await this.prisma.orgRate.findMany({ where: { organizationId } });
    return quoteDestination(graph, orgRates, { countryIso2, mccmnc }, new Date());
  }

  async quoteMap(organizationId: string | null): Promise<Map<string, Quote>> {
    const graph = await this.graph();
    const orgRates =
      organizationId === null
        ? []
        : await this.prisma.orgRate.findMany({ where: { organizationId } });
    const now = new Date();
    const prices = new Map<string, Quote>();
    for (const country of graph.countries) {
      const quote = quoteDestination(
        graph,
        orgRates,
        { countryIso2: country.iso2, mccmnc: null },
        now,
      );
      if (quote !== null) {
        prices.set(country.iso2, quote);
      }
    }
    return prices;
  }

  async rateTable(query: { q?: string; page: number; pageSize: number; organizationId?: string }) {
    const graph = await this.graph();
    const orgRates =
      query.organizationId === undefined
        ? []
        : await this.prisma.orgRate.findMany({ where: { organizationId: query.organizationId } });
    const now = new Date();
    const names = new Map(graph.countries.map((country) => [country.iso2, country.name]));
    const keys = destinationKeys(graph, orgRates);
    const needle = query.q?.trim().toLowerCase() ?? '';
    const filtered = keys.filter((key) => {
      if (needle === '') {
        return true;
      }
      const name = names.get(key.countryIso2) ?? '';
      return (
        key.countryIso2.toLowerCase().includes(needle) ||
        name.toLowerCase().includes(needle) ||
        (key.mccmnc ?? '').includes(needle)
      );
    });
    const pageRows = filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    return {
      total: filtered.length,
      page: query.page,
      pageSize: query.pageSize,
      items: pageRows.map((key) => {
        const price = quoteDestination(graph, orgRates, key, now);
        return {
          countryIso2: key.countryIso2,
          countryName: names.get(key.countryIso2) ?? key.countryIso2,
          mccmnc: key.mccmnc,
          source: price?.source ?? null,
          price: price === null ? null : presentMoney(price.micros, 4),
        };
      }),
    };
  }

  async describeRoutes(query: {
    q?: string;
    page: number;
    pageSize: number;
    country?: string;
    providerId?: string;
  }) {
    const graph = await this.graph();
    const now = new Date();
    const names = new Map(graph.countries.map((country) => [country.iso2, country.name]));
    const needle = query.q?.trim().toLowerCase() ?? '';
    const rows = graph.routes.filter((route) => {
      if (query.country !== undefined && route.countryIso2 !== query.country) {
        return false;
      }
      if (query.providerId !== undefined && route.providerId !== query.providerId) {
        return false;
      }
      if (needle === '') {
        return true;
      }
      const provider = graph.providerById.get(route.providerId);
      const name = names.get(route.countryIso2) ?? '';
      return (
        route.countryIso2.toLowerCase().includes(needle) ||
        name.toLowerCase().includes(needle) ||
        (route.mccmnc ?? '').includes(needle) ||
        (provider?.code.toLowerCase().includes(needle) ?? false)
      );
    });
    rows.sort((left, right) => {
      const byCountry = left.countryIso2.localeCompare(right.countryIso2);
      if (byCountry !== 0) {
        return byCountry;
      }
      return left.priority - right.priority;
    });
    const pageRows = rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    return {
      total: rows.length,
      page: query.page,
      pageSize: query.pageSize,
      items: pageRows.map((route) => {
        const provider = graph.providerById.get(route.providerId);
        const markup =
          provider === undefined
            ? null
            : effectiveMarkup(provider.markupPercent, route.markupPercent);
        const price =
          provider === undefined || markup === null
            ? null
            : quoteFromCost(route.costMicros, markup.percent);
        const primary = selectPrimaryRoute(usableRoutes(graph), route.countryIso2, route.mccmnc);
        const listPrice = quoteDestination(graph, [], route, now);
        return {
          id: route.id,
          countryIso2: route.countryIso2,
          countryName: names.get(route.countryIso2) ?? route.countryIso2,
          mccmnc: route.mccmnc,
          providerId: route.providerId,
          providerCode: provider?.code ?? '',
          priority: route.priority,
          weight: route.weight,
          enabled: route.enabled,
          cost: presentMoney(route.costMicros, 4),
          markupPercent: markup?.percent ?? null,
          markupSource: markup?.source ?? null,
          price: price === null ? null : presentMoney(price, 4),
          margin: price === null ? null : presentMoney(marginMicros(price, route.costMicros), 4),
          setsListPrice: primary?.id === route.id && listPrice?.source === 'computed',
        };
      }),
    };
  }

  async graph() {
    const [routes, providers, rates, countries] = await Promise.all([
      this.prisma.route.findMany(),
      this.prisma.provider.findMany(),
      this.prisma.rate.findMany(),
      this.prisma.country.findMany({ where: { enabled: true } }),
    ]);
    return {
      routes,
      providers,
      rates,
      countries,
      providerById: new Map(providers.map((provider) => [provider.id, provider])),
    };
  }
}

type Graph = Awaited<ReturnType<PricingService['graph']>>;

function usableRoutes(graph: Graph) {
  return graph.routes.filter((route) => {
    const provider = graph.providerById.get(route.providerId);
    return route.enabled && provider?.status === 'ACTIVE';
  });
}

function quoteDestination(
  graph: Graph,
  orgRates: readonly {
    countryIso2: string;
    mccmnc: string | null;
    priceMicros: bigint;
    effectiveFrom: Date;
  }[],
  destination: Destination,
  now: Date,
): Quote | null {
  const primary = selectPrimaryRoute(
    usableRoutes(graph),
    destination.countryIso2,
    destination.mccmnc,
  );
  const provider = primary === null ? undefined : graph.providerById.get(primary.providerId);
  const computed =
    primary === null || provider === undefined
      ? null
      : quoteFromCost(
          primary.costMicros,
          effectiveMarkup(provider.markupPercent, primary.markupPercent).percent,
        );
  return resolveCustomerPrice({
    orgMicros: currentFixedPrice(orgRates, destination.countryIso2, destination.mccmnc, now),
    manualMicros: currentFixedPrice(graph.rates, destination.countryIso2, destination.mccmnc, now),
    computedMicros: computed,
  });
}

function destinationKeys(
  graph: Graph,
  orgRates: readonly { countryIso2: string; mccmnc: string | null }[],
): Destination[] {
  const keys = new Map<string, Destination>();
  for (const country of graph.countries) {
    keys.set(`${country.iso2}:`, { countryIso2: country.iso2, mccmnc: null });
  }
  const extras = [...graph.routes, ...graph.rates, ...orgRates];
  for (const row of extras) {
    if (
      row.mccmnc !== null &&
      graph.countries.some((country) => country.iso2 === row.countryIso2)
    ) {
      keys.set(`${row.countryIso2}:${row.mccmnc}`, {
        countryIso2: row.countryIso2,
        mccmnc: row.mccmnc,
      });
    }
  }
  return [...keys.values()].sort((left, right) => {
    const byCountry = left.countryIso2.localeCompare(right.countryIso2);
    if (byCountry !== 0) {
      return byCountry;
    }
    return (left.mccmnc ?? '').localeCompare(right.mccmnc ?? '');
  });
}
