import { decryptString } from '@smsvio/shared/developer';
import {
  MockProvider,
  SentDmClient,
  httpProviderConfigSchema,
  interpretHttpSend,
  sentDmProviderConfigSchema,
  sentDmSendResult,
  sentDmSettingsFromEnv,
  type ProviderSendRequest,
  type ProviderSendResult,
  type SentDmFetch,
} from '@smsvio/shared/provider';
import { SmppPool, smppConfigSchema } from './smpp-link.js';
import { postCarrier } from './webhook-post.js';

interface ProviderRow {
  readonly id: string;
  readonly code: string;
  readonly type: string;
  readonly configEnc: string | null;
  readonly callbackSecretHash: string | null;
}

let pool = new SmppPool();

export function drainCarrier(): ReturnType<SmppPool['drain']> {
  return pool.drain();
}

/** Tests pass a scripted pool so a live SMPP config never opens a socket. */
export function useSmppPool(next: SmppPool): void {
  pool.close();
  pool = next;
}

/**
 * Test keys stay on the mock provider. Live SMPP and HTTP use the encrypted admin config.
 * Live Sent.dm uses SENT_DM_API_KEY from the environment and the admin template map.
 */
export async function sendThroughProvider(input: {
  provider: ProviderRow;
  request: ProviderSendRequest;
  billable: boolean;
  encryptionKey: string | undefined;
  /** Tests pass these so no real Sent call is made. */
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: SentDmFetch;
}): Promise<ProviderSendResult> {
  const live =
    input.billable &&
    (input.provider.type === 'SMPP' ||
      input.provider.type === 'HTTP' ||
      input.provider.type === 'SENT_DM');
  if (!live) {
    return new MockProvider({
      code: input.provider.code,
      callbackSecretHash: input.provider.callbackSecretHash,
    }).send(input.request);
  }
  if (input.provider.type === 'SENT_DM') {
    return sendThroughSentDm(input);
  }
  const config = readConfig(input.provider.configEnc, input.encryptionKey);
  if (config === null) {
    return { status: 'temporary_failure', errorCode: 'carrier_rejected' };
  }
  if (input.provider.type === 'HTTP') {
    const parsed = httpProviderConfigSchema.safeParse(config);
    if (!parsed.success) {
      return { status: 'temporary_failure', errorCode: 'carrier_rejected' };
    }
    try {
      const response = await postCarrier(
        parsed.data.url,
        parsed.data.headers,
        JSON.stringify({
          to: input.request.to,
          from: input.request.from,
          text: input.request.body,
        }),
      );
      return interpretHttpSend(parsed.data, response);
    } catch {
      return { status: 'temporary_failure', errorCode: 'carrier_rejected' };
    }
  }
  const smpp = smppConfigSchema.safeParse(config);
  if (!smpp.success) {
    return { status: 'temporary_failure', errorCode: 'carrier_rejected' };
  }
  return pool.submit(input.provider.id, smpp.data, input.request);
}

/** Sent sends approved templates only. A message without a mapped Sent template is not sent. */
async function sendThroughSentDm(input: {
  provider: ProviderRow;
  request: ProviderSendRequest;
  encryptionKey: string | undefined;
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: SentDmFetch;
}): Promise<ProviderSendResult> {
  const settings = sentDmSettingsFromEnv(input.env ?? process.env);
  if (settings === null) {
    return { status: 'temporary_failure', errorCode: 'carrier_rejected' };
  }
  const raw =
    input.provider.configEnc === null
      ? {}
      : readConfig(input.provider.configEnc, input.encryptionKey);
  const config = sentDmProviderConfigSchema.safeParse(raw ?? undefined);
  if (!config.success) {
    return { status: 'temporary_failure', errorCode: 'carrier_rejected' };
  }
  const templateId = input.request.templateId ?? null;
  const sentTemplateId = templateId === null ? undefined : config.data.templates[templateId];
  if (sentTemplateId === undefined) {
    return { status: 'permanent_failure', errorCode: 'template_not_approved' };
  }
  const client = new SentDmClient({
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    sandbox: settings.sandbox,
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
  });
  const result = await client.sendMessage({
    to: [input.request.to],
    templateId: sentTemplateId,
    ...(input.request.variables === undefined ? {} : { variables: input.request.variables }),
    channel: config.data.channel,
    ...(input.request.messageId === undefined ? {} : { idempotencyKey: input.request.messageId }),
  });
  const mapped = sentDmSendResult(result);
  if (mapped.status === 'accepted' && mapped.providerTemplateId === undefined) {
    return { ...mapped, providerTemplateId: sentTemplateId };
  }
  return mapped;
}

function readConfig(configEnc: string | null, key: string | undefined): unknown {
  if (configEnc === null || key === undefined) {
    return null;
  }
  try {
    return JSON.parse(decryptString(configEnc, key)) as unknown;
  } catch {
    return null;
  }
}
