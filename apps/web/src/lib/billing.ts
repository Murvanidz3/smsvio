import { api, ApiError } from '@/lib/api';

export interface Money {
  micros: string;
  display: string;
}

export interface Overview {
  verification: string;
  templates: number;
  contacts: number;
  deliverability: number | null;
  balance: { available: Money; held: Money };
  totals: { sent: number; delivered: number; failed: number; spend: Money };
  days: { day: string; sent: number; delivered: number; failed: number; spend: Money }[];
  recentContacts: {
    id: string;
    phone: string;
    country: string;
    dialCode: string;
    optedOut: boolean;
  }[];
}

export interface BillingView {
  balance: { available: Money; held: Money };
  payments: 'unconfigured';
  autoRecharge: 'idle' | 'below_threshold';
  preferences: BillingPreferences;
}

export interface BillingPreferences {
  email: string;
  name: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  countryIso2: string;
  lowBalance: string;
  autoRechargeEnabled: boolean;
  autoRechargeThreshold: string;
  autoRechargeAmount: string;
}

export interface LedgerPage {
  total: number;
  page: number;
  pageSize: number;
  items: {
    id: string;
    type: string;
    description: string;
    status: string;
    amount: Money;
    balanceAfter: Money;
    createdAt: string;
  }[];
}

export interface RateRow {
  country: string;
  name: string;
  dialCode: string;
  price: Money;
}

export const insightApi = {
  overview: (query: string) => api<Overview>(`/api/internal/overview${query}`),
  billing: () => api<BillingView>('/api/internal/billing'),
  saveBilling: (body: Partial<BillingPreferences>) =>
    api<BillingPreferences>('/api/internal/billing', { method: 'PATCH', body }),
  history: (query: string) => api<LedgerPage>(`/api/internal/billing/entries${query}`),
  rates: () => api<{ items: RateRow[] }>('/api/internal/pricing/rates'),
  topUp: (amount: string) =>
    api<never>('/api/internal/billing/top-ups', { method: 'POST', body: { amount } }),
};

export async function downloadReceipt(id: string): Promise<void> {
  const response = await fetch(`/api/internal/billing/entries/${id}/receipt`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new ApiError(response.status, 'request_failed', 'That receipt could not be downloaded.');
  }
  const text = await response.text();
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `receipt-${id.slice(0, 8)}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}
