import { api } from '@/lib/api';

export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

import type { Money } from '@/lib/senders';

export interface AdminOrganization {
  id: string;
  name: string;
  legalName: string | null;
  status: string;
  createdAt: string;
  available: Money;
  held: Money;
  spendCap: Money;
  spendCapSource: 'platform' | 'organization';
}

export interface OrganizationList {
  total: number;
  page: number;
  pageSize: number;
  platformSpendCap: Money;
  items: AdminOrganization[];
}

export interface AdminProvider {
  id: string;
  code: string;
  type: string;
  status: string;
  maxTps: number;
  markupPercent: number;
  hasCredentials: boolean;
  hasCallbackSecret: boolean;
  routes: number;
}

export interface AdminRoute {
  id: string;
  countryIso2: string;
  countryName: string;
  mccmnc: string | null;
  providerId: string;
  providerCode: string;
  priority: number;
  weight: number;
  enabled: boolean;
  cost: Money;
  markupPercent: number | null;
  markupSource: 'provider' | 'route' | null;
  price: Money | null;
  margin: Money | null;
  setsListPrice: boolean;
}

export interface AdminRate {
  countryIso2: string;
  countryName: string;
  mccmnc: string | null;
  source: 'per-customer' | 'manual' | 'computed' | null;
  price: Money | null;
}

export interface RatePreview {
  ok: boolean;
  rows?: { line: number; countryIso2: string; mccmnc: string | null; price: Money }[];
  errors?: { line: number; message: string }[];
}

export const adminApi = {
  organizations: (query: string) =>
    api<OrganizationList>(`/api/internal/admin/organizations${query}`),
  setStatus: (id: string, status: 'ACTIVE' | 'SUSPENDED') =>
    api<{ message: string }>(`/api/internal/admin/organizations/${id}/status`, {
      method: 'POST',
      body: { status },
    }),
  adjust: (id: string, body: { direction: 'credit' | 'debit'; amount: string; reason: string }) =>
    api<{ message: string }>(`/api/internal/admin/organizations/${id}/balance`, {
      method: 'POST',
      body,
    }),
  setSpendCap: (id: string, dailySpendCap: string | null) =>
    api<{ message: string }>(`/api/internal/admin/organizations/${id}/spend-cap`, {
      method: 'PATCH',
      body: { dailySpendCap },
    }),
  setPlatformCap: (defaultDailySpendCap: string) =>
    api<{ message: string }>('/api/internal/admin/settings', {
      method: 'PATCH',
      body: { defaultDailySpendCap },
    }),
  countries: () =>
    api<{ items: { iso2: string; name: string; dialCode: string }[] }>(
      '/api/internal/admin/countries',
    ),
  providers: () => api<{ items: AdminProvider[] }>('/api/internal/admin/providers'),
  createProvider: (body: {
    code: string;
    type: string;
    markupPercent: number;
    maxTps: number;
    config?: string;
  }) =>
    api<{ id: string; message: string; callbackSecret: string }>('/api/internal/admin/providers', {
      method: 'POST',
      body,
    }),
  health: (id: string) =>
    api<{ ok: boolean; detail: string }>(`/api/internal/admin/providers/${id}/health`, {
      method: 'POST',
    }),
  updateRoute: (
    id: string,
    body: {
      priority: number;
      weight: number;
      cost: string;
      markupPercent: number | null;
      enabled: boolean;
    },
  ) => api<{ message: string }>(`/api/internal/admin/routes/${id}`, { method: 'PATCH', body }),
  routes: (query: string) =>
    api<{ total: number; items: AdminRoute[] }>(`/api/internal/admin/routes${query}`),
  createRoute: (body: {
    countryIso2: string;
    mccmnc: string | null;
    providerId: string;
    priority: number;
    weight: number;
    cost: string;
    markupPercent: number | null;
    enabled: boolean;
  }) => api<{ message: string }>('/api/internal/admin/routes', { method: 'POST', body }),
  rates: (query: string) =>
    api<{ total: number; page: number; pageSize: number; items: AdminRate[] }>(
      `/api/internal/admin/rates${query}`,
    ),
  previewRates: (csv: string) =>
    api<RatePreview>('/api/internal/admin/rates/preview', { method: 'POST', body: { csv } }),
  importRates: (csv: string) =>
    api<{ message: string }>('/api/internal/admin/rates/import', { method: 'POST', body: { csv } }),
  orgRate: (body: {
    organizationId: string;
    countryIso2: string;
    mccmnc: string | null;
    price: string;
  }) => api<{ message: string }>('/api/internal/admin/rates/org', { method: 'POST', body }),
};
