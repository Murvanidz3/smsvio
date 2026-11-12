import { api } from '@/lib/api';

export interface Money {
  micros: string;
  display: string;
}

export interface SenderDestination {
  iso2: string;
  name: string;
  dialCode: string;
  alphaSenderAllowed: boolean;
  registrationRequired: boolean;
  enabled: boolean;
  orgCountryId: string | null;
  registrationComplete: boolean;
  sender: { id: string | null; value: string; label: string } | null;
  price: Money | null;
  priceSource: 'per-customer' | 'manual' | 'computed' | null;
}

export interface SenderRequest {
  id: string;
  type: string;
  value: string;
  status: string;
  useCase: string;
  reviewNote: string | null;
  countries: string[];
  createdAt: string;
}

export interface SenderOverview {
  platformSender: { value: string; label: string } | null;
  destinations: SenderDestination[];
  senderIds: SenderRequest[];
}

export const senderApi = {
  overview: () => api<SenderOverview>('/api/internal/senders'),
  addCountry: (body: { countryIso2: string; senderId: string | null }) =>
    api<{ id: string; message: string }>('/api/internal/org-countries', { method: 'POST', body }),
  removeCountry: (id: string) =>
    api<{ message: string }>(`/api/internal/org-countries/${id}`, { method: 'DELETE' }),
  requestSender: (body: { type: string; value: string; useCase: string; countries: string[] }) =>
    api<{ id: string; message: string }>('/api/internal/sender-ids', { method: 'POST', body }),
};
