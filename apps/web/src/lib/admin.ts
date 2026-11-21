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
  sharedSender: string | null;
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

export interface TrafficTally {
  total: number;
  queued: number;
  sending: number;
  sent: number;
  delivered: number;
  failed: number;
  deliveryRate: number | null;
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
  setSharedSender: (sharedSender: string) =>
    api<{ message: string }>('/api/internal/admin/settings', {
      method: 'PATCH',
      body: { sharedSender },
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
  reviews: () =>
    api<{
      verification: { organizationId: string; name: string; legalName: string }[];
      useCases: { id: string; purpose: string }[];
      senders: { id: string; value: string }[];
      templates: { id: string; name: string }[];
    }>('/api/internal/admin/reviews'),
  decide: (path: string, id: string, decision: 'approve' | 'reject', note: string) =>
    api<{ message: string }>(`/api/internal/admin/reviews/${path}/${id}`, {
      method: 'POST',
      body: { decision, note },
    }),
  system: () =>
    api<{
      queues: {
        send: number;
        delayed: number;
        receipts: number;
        webhooks: number;
        webhookDelay: number;
      };
      receiptLag: number;
      errorGroups: { errorCode: string; count: number }[];
      stuck: { id: string; to: string; sentAt: string | null }[];
    }>('/api/internal/admin/health'),
  operations: () =>
    api<{
      paused: boolean;
      today: TrafficTally;
      queues: { send: number; delayed: number; receipts: number };
      routes: (TrafficTally & {
        id: string;
        countryIso2: string;
        mccmnc: string | null;
        providerCode: string;
        providerType: string;
        enabled: boolean;
        maxTps: number;
        lastMinute: number;
      })[];
      open: {
        id: string;
        organizationName: string;
        to: string;
        status: string;
        countryIso2: string | null;
      }[];
    }>('/api/internal/admin/operations'),
  statistics: (day: string) =>
    api<{
      day: string;
      byRoute: (TrafficTally & { routeId: string; countryIso2: string; providerCode: string })[];
      byOrganization: (TrafficTally & { organizationId: string; name: string })[];
    }>(`/api/internal/admin/statistics?day=${encodeURIComponent(day)}`),
  setSendingPaused: (paused: boolean) =>
    api<{ paused: boolean; message: string }>('/api/internal/admin/sending', {
      method: 'POST',
      body: { paused },
    }),
  margin: () =>
    api<{
      items: { country: string; providerId: string; revenue: Money; cost: Money; margin: Money }[];
    }>('/api/internal/admin/margin'),
  messages: (query: string) =>
    api<{
      total: number;
      items: {
        id: string;
        to: string;
        status: string;
        direction: string;
        errorCode: string | null;
        countryIso2: string | null;
      }[];
    }>(`/api/internal/admin/messages${query}`),
  audit: (query: string) =>
    api<{ total: number; items: { id: string; action: string; createdAt: string }[] }>(
      `/api/internal/admin/audit${query}`,
    ),
};
