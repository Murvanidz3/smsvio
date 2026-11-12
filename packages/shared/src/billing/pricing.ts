export interface RouteCandidate {
  readonly id: string;
  readonly countryIso2: string;
  readonly mccmnc: string | null;
  readonly priority: number;
  readonly weight: number;
  readonly enabled: boolean;
}

/**
 * The enabled route that sets the computed price.
 * A network match beats a country-wide route. Lower priority wins, then higher weight, then id.
 */
export function selectPrimaryRoute<T extends RouteCandidate>(
  routes: readonly T[],
  countryIso2: string,
  mccmnc: string | null,
): T | null {
  const enabled = routes.filter((route) => route.enabled && route.countryIso2 === countryIso2);
  const specific = mccmnc === null ? [] : enabled.filter((route) => route.mccmnc === mccmnc);
  const pool = specific.length > 0 ? specific : enabled.filter((route) => route.mccmnc === null);
  return pool.slice().sort(compareRoutes)[0] ?? null;
}

/** Network-specific routes first, then country-wide routes. Each group uses the primary-route order. */
export function orderedRoutes<T extends RouteCandidate>(
  routes: readonly T[],
  countryIso2: string,
  mccmnc: string | null,
): T[] {
  const enabled = routes.filter((route) => route.enabled && route.countryIso2 === countryIso2);
  const specific = mccmnc === null ? [] : enabled.filter((route) => route.mccmnc === mccmnc);
  const countryWide = enabled.filter((route) => route.mccmnc === null);
  return [...specific.slice().sort(compareRoutes), ...countryWide.slice().sort(compareRoutes)];
}

function compareRoutes(left: RouteCandidate, right: RouteCandidate): number {
  if (left.priority !== right.priority) {
    return left.priority - right.priority;
  }
  if (left.weight !== right.weight) {
    return right.weight - left.weight;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
}

export type PriceSource = 'per-customer' | 'manual' | 'computed';

/** OrgRate, then a manual country Rate, then the price computed from the primary route. */
export function resolveCustomerPrice(input: {
  readonly orgMicros: bigint | null;
  readonly manualMicros: bigint | null;
  readonly computedMicros: bigint | null;
}): { micros: bigint; source: PriceSource } | null {
  if (input.orgMicros !== null) {
    return { micros: input.orgMicros, source: 'per-customer' };
  }
  if (input.manualMicros !== null) {
    return { micros: input.manualMicros, source: 'manual' };
  }
  if (input.computedMicros !== null) {
    return { micros: input.computedMicros, source: 'computed' };
  }
  return null;
}

export interface PricedRate {
  readonly countryIso2: string;
  readonly mccmnc: string | null;
  readonly priceMicros: bigint;
  readonly effectiveFrom: Date;
}

/** Latest row with effectiveFrom at or before `now` for one destination. */
export function currentFixedPrice(
  rows: readonly PricedRate[],
  countryIso2: string,
  mccmnc: string | null,
  now: Date,
): bigint | null {
  let best: PricedRate | null = null;
  for (const row of rows) {
    if (row.countryIso2 !== countryIso2 || row.mccmnc !== mccmnc) {
      continue;
    }
    if (row.effectiveFrom.getTime() > now.getTime()) {
      continue;
    }
    if (best === null || row.effectiveFrom.getTime() > best.effectiveFrom.getTime()) {
      best = row;
    }
  }
  return best?.priceMicros ?? null;
}
