import { publicRatesSchema } from '@smsvio/shared';

export interface MarketingCountry {
  readonly iso: string;
  readonly name: string;
  readonly dialCode: string;
  readonly alphaSenderAllowed: boolean;
  readonly registrationRequired: boolean;
}

export interface MarketingRates {
  readonly count: number;
  readonly countries: readonly MarketingCountry[];
}

const EMPTY: MarketingRates = { count: 0, countries: [] };

export async function loadPublicRates(): Promise<MarketingRates> {
  const base =
    process.env.API_INTERNAL_URL ??
    (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:4000' : undefined);
  if (base === undefined) {
    return EMPTY;
  }
  try {
    const response = await fetch(new URL('/api/public/rates', base), {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) {
      return EMPTY;
    }
    const parsed = publicRatesSchema.safeParse(await response.json());
    if (!parsed.success) {
      return EMPTY;
    }
    return {
      count: parsed.data.count,
      countries: parsed.data.countries.map((country) => ({
        iso: country.iso,
        name: country.name,
        dialCode: country.dial_code,
        alphaSenderAllowed: country.alpha_sender_allowed,
        registrationRequired: country.registration_required,
      })),
    };
  } catch {
    // The landing page is specified to render when this list cannot be loaded.
    return EMPTY;
  }
}
