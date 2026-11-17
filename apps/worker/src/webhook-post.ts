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
  const parsed = parseWebhookUrl(url);
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }
  const records = await lookup(parsed.target.hostname, { all: true, order: 'verbatim' });
  if (records.length === 0 || records.some((record) => isBlockedDeliveryAddress(record.address))) {
    throw new Error('That address is not allowed.');
  }
  const pinned = records[0];
  if (pinned === undefined) {
    throw new Error('That address is not allowed.');
  }
  const started = Date.now();
  const status = await requestPinned(parsed.target, pinned.address, pinned.family, headers, body);
  return { status, durationMs: Math.max(0, Date.now() - started) };
}

function requestPinned(
  target: WebhookTarget,
  address: string,
  family: number,
  headers: Readonly<Record<string, string>>,
  body: string,
): Promise<number> {
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
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on('timeout', () => {
      request.destroy(new Error('Webhook delivery timed out.'));
    });
    request.on('error', reject);
    request.end(body);
  });
}
