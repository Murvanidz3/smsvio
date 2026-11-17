import { api } from '@/lib/api';

export interface ComplianceView {
  status: string;
  profile: {
    legalName: string;
    address: string;
    website: string;
    registrationNumber: string;
    registrationCountry: string;
    submittedAt: string;
    reviewNote: string;
  } | null;
  useCases: {
    id: string;
    purpose: string;
    sample: string;
    optIn: string;
    status: string;
    reviewNote: string;
  }[];
  documents: { id: string; country: string; kind: string; filename: string; contentType: string }[];
  replies: { id: string; category: string; keywords: string[]; body: string; protected: boolean }[];
}

export const complianceApi = {
  view: () => api<ComplianceView>('/api/internal/compliance'),
  business: (body: {
    legalName: string;
    address: string;
    website: string;
    registrationNumber: string;
    registrationCountry: string;
  }) => api<{ submittedAt: string }>('/api/internal/compliance/business', { method: 'POST', body }),
  useCase: (body: { purpose: string; sample: string; optIn: string }) =>
    api<{ id: string }>('/api/internal/compliance/use-cases', { method: 'POST', body }),
  reply: (body: { category: string; keywords: string[]; body: string }) =>
    api<{ id: string }>('/api/internal/compliance/replies', { method: 'POST', body }),
};
