import { z } from 'zod';

/** Public country row. Prices, costs, providers, routes and margins are never included. */
export const publicCountrySchema = z
  .object({
    iso: z.string().regex(/^[A-Z]{2}$/),
    name: z.string().min(1),
    dial_code: z.string().min(1),
    alpha_sender_allowed: z.boolean(),
    registration_required: z.boolean(),
  })
  .strict();

export const publicRatesSchema = z
  .object({
    count: z.number().int().nonnegative(),
    countries: z.array(publicCountrySchema),
  })
  .strict()
  .refine((value) => value.count === value.countries.length, {
    message: 'Count does not match the country list.',
  });

export type PublicCountry = z.infer<typeof publicCountrySchema>;
export type PublicRates = z.infer<typeof publicRatesSchema>;
