import { encryptString } from '@smsvio/shared/developer';
import type { SentDmFetch } from '@smsvio/shared/provider';
import { describe, expect, it, vi } from 'vitest';

import { sendThroughProvider } from './carrier.js';

const key = 'ab'.repeat(32);
const smsvioTemplate = '0b6f1a52-6c0e-4c55-9a37-7f1e2d3c4b5a';
const env = { SENT_DM_API_KEY: 'test-key', SENT_DM_BASE_URL: 'https://sent.example' };

const request = {
  to: '+995599780780',
  from: 'SMSVIO',
  body: 'Your code is 1234',
  encoding: 'GSM-7',
  segments: 1,
  messageId: '5d1c3a8e-2b7f-4e61-9c0d-1a2b3c4d5e6f',
  templateId: smsvioTemplate,
  variables: { code: '1234' },
};

function provider(config: unknown) {
  return {
    id: 'p-sent',
    code: 'sent',
    type: 'SENT_DM',
    configEnc: config === null ? null : encryptString(JSON.stringify(config), key),
    callbackSecretHash: null,
  };
}

function accepted(): SentDmFetch {
  return vi.fn<SentDmFetch>(() =>
    Promise.resolve({
      status: 202,
      headers: { get: () => null },
      text: () =>
        Promise.resolve(
          JSON.stringify({
            success: true,
            data: {
              status: 'QUEUED',
              template_id: 'sent-tpl-1',
              recipients: [{ message_id: 'sent-msg-1', to: request.to, channel: 'sms' }],
            },
            meta: { request_id: 'req_1' },
          }),
        ),
    }),
  );
}

describe('Sent.dm carrier', () => {
  it('sends the mapped Sent template with the message id as idempotency key', async () => {
    const fetch = accepted();
    const result = await sendThroughProvider({
      provider: provider({ templates: { [smsvioTemplate]: 'sent-tpl-1' } }),
      request,
      billable: true,
      encryptionKey: key,
      env: { ...env, SENT_DM_SANDBOX: 'true' },
      fetch,
    });
    expect(result).toEqual({
      status: 'accepted',
      providerMessageId: 'sent-msg-1',
      providerRequestId: 'req_1',
      channel: 'sms',
      providerTemplateId: 'sent-tpl-1',
    });
    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(init?.headers['Idempotency-Key']).toBe(request.messageId);
    expect(JSON.parse(init?.body ?? '')).toEqual({
      to: ['+995599780780'],
      template: { id: 'sent-tpl-1', parameters: { code: '1234' } },
      channel: ['sms'],
      sandbox: true,
    });
  });

  it('does not call Sent without a key, a template map, or a live message', async () => {
    const fetch = accepted();
    const off = await sendThroughProvider({
      provider: provider({ templates: { [smsvioTemplate]: 'sent-tpl-1' } }),
      request,
      billable: true,
      encryptionKey: key,
      env: {},
      fetch,
    });
    expect(off).toEqual({ status: 'temporary_failure', errorCode: 'carrier_rejected' });
    const unmapped = await sendThroughProvider({
      provider: provider(null),
      request,
      billable: true,
      encryptionKey: key,
      env,
      fetch,
    });
    expect(unmapped).toEqual({ status: 'permanent_failure', errorCode: 'template_not_approved' });
    const test = await sendThroughProvider({
      provider: provider(null),
      request,
      billable: false,
      encryptionKey: key,
      env,
      fetch,
    });
    expect(test.status).toBe('accepted');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a bad key as a permanent provider_auth_failed', async () => {
    const fetch = vi.fn<SentDmFetch>(() =>
      Promise.resolve({
        status: 401,
        headers: { get: () => null },
        text: () => Promise.resolve('{"success":false,"error":{"code":"AUTH_002"}}'),
      }),
    );
    const result = await sendThroughProvider({
      provider: provider({ templates: { [smsvioTemplate]: 'sent-tpl-1' } }),
      request,
      billable: true,
      encryptionKey: key,
      env,
      fetch,
    });
    expect(result).toEqual({ status: 'permanent_failure', errorCode: 'provider_auth_failed' });
  });

  it('falls back on an unreadable config, a missing template, and a sparse response', async () => {
    const fetch = vi.fn<SentDmFetch>(() =>
      Promise.resolve({
        status: 202,
        headers: { get: () => null },
        text: () =>
          Promise.resolve('{"success":true,"data":{"recipients":[{"message_id":"sent-msg-2"}]}}'),
      }),
    );
    const unreadable = await sendThroughProvider({
      provider: { ...provider(null), configEnc: 'v1.not-a-ciphertext' },
      request,
      billable: true,
      encryptionKey: key,
      env,
      fetch,
    });
    expect(unreadable).toEqual({ status: 'temporary_failure', errorCode: 'carrier_rejected' });
    const plain = { to: request.to, from: 'SMSVIO', body: 'Hi', encoding: 'GSM-7', segments: 1 };
    const noTemplate = await sendThroughProvider({
      provider: provider({ templates: { [smsvioTemplate]: 'sent-tpl-1' } }),
      request: plain,
      billable: true,
      encryptionKey: key,
      env,
      fetch,
    });
    expect(noTemplate).toEqual({ status: 'permanent_failure', errorCode: 'template_not_approved' });
    const sparse = await sendThroughProvider({
      provider: provider({ templates: { [smsvioTemplate]: 'sent-tpl-1' } }),
      request: { ...plain, templateId: smsvioTemplate },
      billable: true,
      encryptionKey: key,
      env,
      fetch,
    });
    expect(sparse).toEqual({
      status: 'accepted',
      providerMessageId: 'sent-msg-2',
      providerTemplateId: 'sent-tpl-1',
    });
    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(init?.headers['Idempotency-Key']).toBeUndefined();
    expect(JSON.parse(init?.body ?? '')).toEqual({
      to: [request.to],
      template: { id: 'sent-tpl-1' },
      channel: ['sms'],
    });
  });
});
