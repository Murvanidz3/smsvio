import { lookup } from 'node:dns/promises';
import https from 'node:https';

import { isBlockedDeliveryAddress, parseWebhookUrl, type WebhookTarget } from '@smsvio/shared';

const TIMEOUT_MS = 10_000;

export interface WebhookPostResult {
  readonly status: number;
  readonly durationMs: number;
}

/** POST one webhook. DNS is resolved first and the connection is pinned to that address. */
export async function postWebhook(
  url: string,
  headers: Readonly<Record<string, string>>,
  body: string,
): Promise<WebhookPostResult> {
  const started = Date.now();
  const pinned = await resolvePinned(url);
  const result = await requestPinned(pinned.target, pinned.address, pinned.family, headers, body);
  return { status: result.status, durationMs: Math.max(0, Date.now() - started) };
}

/** HTTPS POST used for a configured HTTP SMS provider. The URL is pinned the same way as a webhook. */
export async function postCarrier(
  url: string,
  headers: Readonly<Record<string, string>>,
  body: string,
): Promise<{ status: number; body: string }> {
  const pinned = await resolvePinned(url);
  return requestPinned(pinned.target, pinned.address, pinned.family, headers, body);
}

async function resolvePinned(
  url: string,
): Promise<{ target: WebhookTarget; address: string; family: number }> {
  const parsed = parseWebhookUrl(url);
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }
  const records = await lookup(parsed.target.hostname, { all: true, order: 'verbatim' });
  const pinned = records[0];
  if (pinned === undefined || records.some((record) => isBlockedDeliveryAddress(record.address))) {
    throw new Error('That address is not allowed.');
  }
  return { target: parsed.target, address: pinned.address, family: pinned.family };
}

function requestPinned(
  target: WebhookTarget,
  address: string,
  family: number,
  headers: Readonly<Record<string, string>>,
  body: string,
): Promise<{ status: number; body: string }> {
  const hostHeader =
    target.port === 443 ? target.hostname : `${target.hostname}:${String(target.port)}`;
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        host: address,
        servername: target.hostname,
        port: target.port,
        path: target.path,
        method: 'POST',
        headers: {
          ...headers,
          host: hostHeader,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
        timeout: TIMEOUT_MS,
        lookup: (
          _hostname: string,
          options: unknown,
          callback?: (error: NodeJS.ErrnoException | null, address: string, family: number) => void,
        ) => {
          if (typeof options === 'function') {
            (
              options as (
                error: NodeJS.ErrnoException | null,
                address: string,
                family: number,
              ) => void
            )(null, address, family);
            return;
          }
          callback?.(null, address, family);
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).subarray(0, 100_000).toString('utf8'),
          });
        });
      },
    );
    request.on('timeout', () => {
      request.destroy(new Error('Webhook delivery timed out.'));
    });
    request.on('error', reject);
    request.end(body);
  });
}
