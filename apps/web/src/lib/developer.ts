import { api } from '@/lib/api';

export interface ApiKeyItem {
  id: string;
  name: string;
  mode: 'LIVE' | 'TEST';
  status: 'ACTIVE' | 'DISABLED';
  masked: string;
  createdAt: string;
  lastUsedAt: string | null;
  secret?: string;
}

export interface ApiKeyList {
  organizationId: string;
  total: number;
  page: number;
  pageSize: number;
  items: ApiKeyItem[];
}

export interface WebhookItem {
  id: string;
  name: string;
  url: string;
  events: string[];
  status: 'ACTIVE' | 'DISABLED';
  consecutiveFailures: number;
  createdAt: string;
}

export interface WebhookDeliveryItem {
  id: string;
  eventId: string;
  eventType: string;
  attempt: number;
  responseStatus: number | null;
  responseMs: number | null;
  status: string;
  nextRetryAt: string | null;
  createdAt: string;
}

export interface WebhookDetail extends WebhookItem {
  deliveries: {
    total: number;
    page: number;
    pageSize: number;
    items: WebhookDeliveryItem[];
  };
}

export interface WebhookList {
  total: number;
  page: number;
  pageSize: number;
  items: WebhookItem[];
}

export const developerApi = {
  keys: (query = '') => api<ApiKeyList>(`/api/internal/api-keys${query}`),
  createKey: (body: { name: string; mode: 'LIVE' | 'TEST' }) =>
    api<ApiKeyItem>('/api/internal/api-keys', { method: 'POST', body }),
  updateKey: (id: string, body: { name?: string; status?: 'ACTIVE' | 'DISABLED' }) =>
    api<ApiKeyItem>(`/api/internal/api-keys/${id}`, { method: 'PATCH', body }),
  deleteKey: (id: string) =>
    api<{ message: string }>(`/api/internal/api-keys/${id}`, { method: 'DELETE' }),
  webhooks: (query = '') => api<WebhookList>(`/api/internal/webhooks${query}`),
  webhook: (id: string, query = '') => api<WebhookDetail>(`/api/internal/webhooks/${id}${query}`),
  createWebhook: (body: { name: string; url: string; events: string[] }) =>
    api<WebhookItem & { secret: string }>('/api/internal/webhooks', { method: 'POST', body }),
  updateWebhook: (
    id: string,
    body: { name?: string; url?: string; events?: string[]; status?: 'ACTIVE' | 'DISABLED' },
  ) => api<WebhookItem>(`/api/internal/webhooks/${id}`, { method: 'PATCH', body }),
  deleteWebhook: (id: string) =>
    api<{ message: string }>(`/api/internal/webhooks/${id}`, { method: 'DELETE' }),
  revealWebhook: (id: string) =>
    api<{ secret: string }>(`/api/internal/webhooks/${id}/secret`, { method: 'POST', body: {} }),
  rotateWebhook: (id: string) =>
    api<{ secret: string }>(`/api/internal/webhooks/${id}/rotate`, { method: 'POST', body: {} }),
  testWebhook: (id: string) =>
    api<{ deliveryId: string; message: string }>(`/api/internal/webhooks/${id}/test`, {
      method: 'POST',
      body: {},
    }),
  replayWebhook: (id: string, deliveryId: string) =>
    api<{ deliveryId: string; message: string }>(`/api/internal/webhooks/${id}/replay`, {
      method: 'POST',
      body: { delivery_id: deliveryId },
    }),
};
