import type {
  AuditListResponse,
  DirectoryResponse,
  InvitePreview,
  SessionListResponse,
  SessionResponse,
  TotpSetupResponse,
} from '@smsvio/shared';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields ?? {};
  }
}

function csrfToken(): string | undefined {
  const entry = document.cookie.split('; ').find((part) => part.startsWith('smsvio_csrf='));
  if (entry === undefined) {
    return undefined;
  }
  return decodeURIComponent(entry.slice('smsvio_csrf='.length));
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const method = init?.method ?? 'GET';
  const headers = new Headers({ accept: 'application/json' });
  if (init?.body !== undefined) {
    headers.set('content-type', 'application/json');
  }
  if (method !== 'GET' && method !== 'HEAD') {
    const token = csrfToken();
    if (token !== undefined) {
      headers.set('x-csrf-token', token);
    }
  }
  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const payload = (await response.json().catch(() => null)) as {
    code?: string;
    message?: string;
    fields?: Record<string, string>;
  } | null;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.code ?? 'request_failed',
      payload?.message ?? 'Something went wrong. Try again.',
      payload?.fields,
    );
  }
  return payload as T;
}

export interface AuthConfig {
  emailMode: 'disabled' | 'smtp';
  google: boolean;
}

export const accountApi = {
  config: () => api<AuthConfig>('/api/internal/auth/config'),
  session: () => api<SessionResponse>('/api/internal/auth/session'),
  signIn: (body: { email: string; password: string }) =>
    api<SessionResponse | { status: 'totp_required'; challenge: string }>(
      '/api/internal/auth/signin',
      {
        method: 'POST',
        body,
      },
    ),
  totp: (body: { challenge?: string; code: string }) =>
    api<SessionResponse>('/api/internal/auth/totp', { method: 'POST', body }),
  signUp: (body: { name: string; email: string; password: string; organizationName: string }) =>
    api<{ message: string }>('/api/internal/auth/signup', { method: 'POST', body }),
  verifyEmail: (token: string) =>
    api<SessionResponse>('/api/internal/auth/verify-email', { method: 'POST', body: { token } }),
  resend: (email: string) =>
    api<{ message: string }>('/api/internal/auth/verification/resend', {
      method: 'POST',
      body: { email },
    }),
  forgot: (email: string) =>
    api<{ message: string }>('/api/internal/auth/forgot-password', {
      method: 'POST',
      body: { email },
    }),
  reset: (token: string, password: string) =>
    api<{ message: string }>('/api/internal/auth/reset-password', {
      method: 'POST',
      body: { token, password },
    }),
  signOut: () =>
    api<{ message: string }>('/api/internal/auth/signout', { method: 'POST', body: {} }),
  previewInvite: (token: string) =>
    api<InvitePreview>('/api/internal/auth/invitations/preview', {
      method: 'POST',
      body: { token },
    }),
  acceptInvite: (body: { token: string; name?: string; password?: string }) =>
    api<SessionResponse | { status: 'sign_in_required'; email: string }>(
      '/api/internal/auth/invitations/accept',
      {
        method: 'POST',
        body,
      },
    ),
  members: (query: string) => api<DirectoryResponse>(`/api/internal/members${query}`),
  invite: (body: { email: string; role: string }) =>
    api<{ id: string; message: string; link?: string }>('/api/internal/invitations', {
      method: 'POST',
      body,
    }),
  resendInvite: (id: string) =>
    api<{ message: string; link?: string }>(`/api/internal/invitations/${id}/resend`, {
      method: 'POST',
      body: {},
    }),
  revokeInvite: (id: string) =>
    api<{ message: string }>(`/api/internal/invitations/${id}`, { method: 'DELETE' }),
  changeRole: (id: string, role: string) =>
    api<{ message: string }>(`/api/internal/members/${id}`, { method: 'PATCH', body: { role } }),
  removeMember: (id: string) =>
    api<{ message: string }>(`/api/internal/members/${id}`, { method: 'DELETE' }),
  transfer: (id: string) =>
    api<SessionResponse>(`/api/internal/members/${id}/transfer`, { method: 'POST', body: {} }),
  updateProfile: (name: string) =>
    api<SessionResponse>('/api/internal/profile', { method: 'PATCH', body: { name } }),
  changePassword: (currentPassword: string, password: string) =>
    api<{ message: string }>('/api/internal/profile/password', {
      method: 'POST',
      body: { currentPassword, password },
    }),
  setPassword: (password: string) =>
    api<{ message: string }>('/api/internal/profile/password/set', {
      method: 'POST',
      body: { password },
    }),
  createOrganization: (name: string) =>
    api<SessionResponse>('/api/internal/organization', { method: 'POST', body: { name } }),
  updateDetails: (body: { timezone: string; contactPhone: string }) =>
    api<SessionResponse>('/api/internal/profile/details', { method: 'PATCH', body }),
  startPhone: (phone: string) =>
    api<{ message: string }>('/api/internal/profile/phone', { method: 'POST', body: { phone } }),
  confirmPhone: (code: string) =>
    api<SessionResponse>('/api/internal/profile/phone/confirm', { method: 'POST', body: { code } }),
  updateBusiness: (body: { legalName: string; taxIdType: string; taxId: string }) =>
    api<SessionResponse>('/api/internal/organization', { method: 'PATCH', body }),
  switchOrganization: (organizationId: string) =>
    api<SessionResponse>('/api/internal/organization/switch', {
      method: 'POST',
      body: { organizationId },
    }),
  deleteOrganization: (confirmName: string) =>
    api<SessionResponse>('/api/internal/organization/delete', {
      method: 'POST',
      body: { confirmName },
    }),
  sessions: () => api<SessionListResponse>('/api/internal/sessions'),
  revokeSession: (id: string) =>
    api<{ message: string }>(`/api/internal/sessions/${id}`, { method: 'DELETE' }),
  audit: () => api<AuditListResponse>('/api/internal/audit?pageSize=10'),
  setupTotp: (currentPassword: string) =>
    api<TotpSetupResponse>('/api/internal/profile/totp/setup', {
      method: 'POST',
      body: { currentPassword },
    }),
  confirmTotp: (code: string) =>
    api<SessionResponse>('/api/internal/profile/totp/confirm', { method: 'POST', body: { code } }),
  disableTotp: (currentPassword: string, code: string) =>
    api<SessionResponse>('/api/internal/profile/totp/disable', {
      method: 'POST',
      body: { currentPassword, code },
    }),
};
