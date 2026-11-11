import { api } from '@/lib/api';

export interface ContactItem {
  id: string;
  shortId: string;
  phoneE164: string;
  countryCode: string;
  name: string | null;
  optedOut: boolean;
  attributes: Record<string, string>;
  createdAt: string;
}

export interface ContactDetail extends ContactItem {
  messages: {
    id: string;
    status: string;
    body: string;
    direction: string;
    from: string | null;
    createdAt: string;
  }[];
}

export interface ContactList {
  total: number;
  page: number;
  pageSize: number;
  items: ContactItem[];
}

export interface ImportResult {
  created: number;
  rejected: { line: number; phone: string; reason: string }[];
  rejectCsv: string;
}

export interface TemplateItem {
  id: string;
  shortId: string;
  name: string;
  category: 'AUTHENTICATION' | 'UTILITY' | 'MARKETING';
  language: string;
  body: string;
  samples: Record<string, string>;
  variables: string[];
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateList {
  total: number;
  page: number;
  pageSize: number;
  items: TemplateItem[];
}

export interface GalleryItem {
  id: string;
  name: string;
  category: TemplateItem['category'];
  language: string;
  body: string;
  samples: Record<string, string>;
}

export interface TemplateAnalytics {
  sent: number;
  delivered: number;
  failed: number;
  points: { date: string; sent: number; delivered: number; failed: number }[];
}

export interface CountryItem {
  iso2: string;
  name: string;
  dialCode: string;
  alphaSenderAllowed: boolean;
  registrationRequired: boolean;
}

export interface PhoneLookup {
  valid: boolean;
  e164: string | null;
  international: string | null;
  national: string | null;
  countryCode: string | null;
  countryName: string | null;
  dialCode: string | null;
  type: string | null;
  region: string | null;
  timeZones: string[];
}

export interface TemplateDraft {
  name?: string;
  category: TemplateItem['category'];
  language: string;
  body: string;
  samples?: Record<string, string>;
}

export const catalogApi = {
  contacts: (query: string) => api<ContactList>(`/api/internal/contacts${query}`),
  contact: (id: string) => api<ContactDetail>(`/api/internal/contacts/${id}`),
  createContact: (body: { phone: string; country?: string; name?: string }) =>
    api<ContactItem>('/api/internal/contacts', { method: 'POST', body }),
  importContacts: (body: {
    csv: string;
    hasHeader: boolean;
    phoneColumn: number;
    nameColumn: number | null;
    countryColumn: number | null;
  }) => api<ImportResult>('/api/internal/contacts/import', { method: 'POST', body }),
  deleteContact: (id: string) =>
    api<{ message: string }>(`/api/internal/contacts/${id}`, { method: 'DELETE' }),
  templates: (query: string) => api<TemplateList>(`/api/internal/templates${query}`),
  template: (id: string) => api<TemplateItem>(`/api/internal/templates/${id}`),
  gallery: () => api<{ items: GalleryItem[] }>('/api/internal/templates/gallery'),
  createTemplate: (body: TemplateDraft) =>
    api<TemplateItem>('/api/internal/templates', { method: 'POST', body }),
  updateTemplate: (id: string, body: TemplateDraft) =>
    api<TemplateItem>(`/api/internal/templates/${id}`, { method: 'PATCH', body }),
  copyGallery: (id: string) =>
    api<TemplateItem>('/api/internal/templates/gallery', { method: 'POST', body: { id } }),
  submitTemplate: (id: string) =>
    api<TemplateItem>(`/api/internal/templates/${id}/submit`, { method: 'POST', body: {} }),
  duplicateTemplate: (id: string) =>
    api<TemplateItem>(`/api/internal/templates/${id}/duplicate`, { method: 'POST', body: {} }),
  deleteTemplate: (id: string) =>
    api<{ message: string }>(`/api/internal/templates/${id}`, { method: 'DELETE' }),
  analytics: (id: string, days: number) =>
    api<TemplateAnalytics>(`/api/internal/templates/${id}/analytics?days=${String(days)}`),
  countries: () => api<{ items: CountryItem[] }>('/api/internal/countries'),
  lookup: (body: { phone: string; country?: string }) =>
    api<PhoneLookup>('/api/internal/tools/lookup', { method: 'POST', body }),
};
