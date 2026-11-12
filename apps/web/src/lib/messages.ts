import { api } from '@/lib/api';
import type { Money } from '@/lib/senders';

export interface MessagePreview {
  to: string;
  from: string;
  countryIso2: string;
  encoding: string;
  segments: number;
  body: string;
  price: Money;
}

export interface QueuedMessage {
  id: string;
  status: string;
  to: string;
  from: string;
  encoding: string;
  segments: number;
  price: Money;
  message: string;
}

export interface MessageRow {
  id: string;
  shortId: string;
  to: string;
  from: string;
  direction: string;
  status: string;
  segments: number;
  price: Money;
  countryIso2: string | null;
  templateName: string | null;
  createdAt: string;
}

export interface MessageDetail extends MessageRow {
  body: string;
  templateCategory: string | null;
  errorCode: string | null;
  error: string | null;
  mccmnc: string | null;
  events: { status: string; detail: string | null; at: string }[];
}

export interface SendBody {
  templateId: string;
  variables?: Record<string, string>;
  to?: string;
  country?: string;
  contactId?: string;
  senderId?: string | null;
}

export const messageApi = {
  preview: (body: SendBody) =>
    api<MessagePreview>('/api/internal/messages/preview', { method: 'POST', body }),
  send: (body: SendBody) => api<QueuedMessage>('/api/internal/messages', { method: 'POST', body }),
  list: (query: string) =>
    api<{ total: number; page: number; pageSize: number; items: MessageRow[] }>(
      `/api/internal/messages${query}`,
    ),
  get: (id: string) => api<MessageDetail>(`/api/internal/messages/${id}`),
};
