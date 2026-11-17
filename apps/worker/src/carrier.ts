import { decryptString } from '@smsvio/shared/developer';
import {
  MockProvider,
  httpProviderConfigSchema,
  interpretHttpSend,
  type ProviderSendRequest,
  type ProviderSendResult,
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

/** Test keys stay on the mock provider. Live SMPP and HTTP use the encrypted admin config. */
export async function sendThroughProvider(input: {
  provider: ProviderRow;
  request: ProviderSendRequest;
  billable: boolean;
  encryptionKey: string | undefined;
}): Promise<ProviderSendResult> {
  const live = input.billable && (input.provider.type === 'SMPP' || input.provider.type === 'HTTP');
  if (!live) {
    return new MockProvider({
      code: input.provider.code,
      callbackSecretHash: input.provider.callbackSecretHash,
    }).send(input.request);
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
