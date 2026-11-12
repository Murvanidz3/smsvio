/**
 * Sends 100 messages per second for 10 minutes at the local Compose stack.
 * Refuses any host other than localhost. Never point this at production.
 */
import { execFileSync } from 'node:child_process';

const base = process.env.LOAD_BASE_URL ?? 'http://localhost:8080';
const origin = new URL(base);
if (origin.hostname !== 'localhost' && origin.hostname !== '127.0.0.1') {
  throw new Error(`Refusing to load-test ${origin.hostname}. Use the local Compose stack.`);
}

const rate = 100;
const seconds = 10 * 60;
const total = rate * seconds;
const phone = '+4915123456789';
const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@smsvio.test';
const password = process.env.SEED_ADMIN_PASSWORD ?? 'smsvio-demo-local';
const jar = new Map();

function remember(response) {
  const lines =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter((value) => value !== null);
  for (const line of lines) {
    const pair = line.split(';')[0] ?? '';
    const split = pair.indexOf('=');
    if (split > 0) {
      jar.set(pair.slice(0, split), pair.slice(split + 1));
    }
  }
}

function csrf() {
  return decodeURIComponent(jar.get('smsvio_csrf') ?? '');
}

async function call(path, { method = 'GET', body } = {}) {
  const headers = new Headers({ accept: 'application/json', origin: origin.origin });
  const token = csrf();
  if (token !== '') {
    headers.set('x-csrf-token', token);
  }
  if (jar.size > 0) {
    headers.set('cookie', [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; '));
  }
  if (body !== undefined) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(new URL(path, origin), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  remember(response);
  const text = await response.text();
  const payload = text === '' ? null : JSON.parse(text);
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload ? payload.message : text;
    throw new Error(`${method} ${path} returned ${String(response.status)}: ${String(message)}`);
  }
  return { status: response.status, payload };
}

function sql(statement) {
  const output = execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      process.env.POSTGRES_USER ?? 'smsvio',
      '-d',
      process.env.POSTGRES_DB ?? 'smsvio',
      '-tAc',
      statement,
    ],
    { encoding: 'utf8' },
  );
  return output.trim();
}

async function prepare() {
  await call('/api/internal/auth/signin', {
    method: 'POST',
    body: { email, password },
  });
  const organizations = await call('/api/internal/admin/organizations?pageSize=10');
  const organization = organizations.payload.items[0];
  if (organization === undefined) {
    throw new Error('The local stack has no organization.');
  }
  if (organization.status !== 'ACTIVE') {
    await call(`/api/internal/admin/organizations/${organization.id}/status`, {
      method: 'POST',
      body: { status: 'ACTIVE' },
    });
  }
  await call(`/api/internal/admin/organizations/${organization.id}/spend-cap`, {
    method: 'PATCH',
    body: { dailySpendCap: '100000' },
  });
  await call(`/api/internal/admin/organizations/${organization.id}/balance`, {
    method: 'POST',
    body: { direction: 'credit', amount: '2000', reason: 'Local load test balance' },
  });
  const providers = await call('/api/internal/admin/providers');
  const mock = providers.payload.items.find((item) => item.code === 'mock');
  if (mock === undefined) {
    throw new Error('The local stack has no mock provider.');
  }
  await call(`/api/internal/admin/providers/${mock.id}`, {
    method: 'PATCH',
    body: { markupPercent: mock.markupPercent, maxTps: 5000, status: 'ACTIVE' },
  });
  try {
    await call('/api/internal/org-countries', {
      method: 'POST',
      body: { countryIso2: 'DE', senderId: null },
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('409')) {
      throw error;
    }
  }
  const template = await call('/api/internal/templates', {
    method: 'POST',
    body: {
      name: 'Load test',
      category: 'UTILITY',
      language: 'en',
      body: 'Hello from the load test',
    },
  });
  await call(`/api/internal/templates/${template.payload.id}/submit`, { method: 'POST' });
  return template.payload.id;
}

async function sendAll(templateId) {
  let cursor = 0;
  let accepted = 0;
  let rejected = 0;
  let inFlight = 0;
  /** @type {Array<() => void>} */
  const waiters = [];
  const started = Date.now();

  async function one(index) {
    while (inFlight >= 100) {
      await new Promise((resolve) => {
        waiters.push(resolve);
      });
    }
    inFlight += 1;
    try {
      const response = await fetch(new URL('/api/internal/messages', origin), {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          origin: origin.origin,
          'x-csrf-token': csrf(),
          cookie: [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; '),
        },
        body: JSON.stringify({
          templateId,
          to: phone,
          country: 'DE',
          clientRef: `load-${String(index)}`,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      await response.arrayBuffer();
      if (response.status === 202) {
        accepted += 1;
      } else {
        rejected += 1;
      }
    } catch {
      rejected += 1;
    } finally {
      inFlight -= 1;
      waiters.shift()?.();
    }
  }

  /** @type {Promise<void>[]} */
  const tasks = [];
  let reportedSecond = -1;
  while (cursor < total) {
    const second = Math.floor((Date.now() - started) / 1000);
    if (second !== reportedSecond && second % 30 === 0) {
      reportedSecond = second;
      console.log(JSON.stringify({ second, scheduled: cursor, accepted, rejected, inFlight }));
    }
    const due = Math.min(total, Math.floor(((Date.now() - started) / 1000) * rate));
    while (cursor < due) {
      tasks.push(one(cursor));
      cursor += 1;
    }
    if (cursor < total) {
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
    }
  }
  await Promise.all(tasks);
  return { accepted, rejected, elapsedMs: Date.now() - started };
}

async function drain() {
  const deadline = Date.now() + 15 * 60 * 1000;
  let pending = '';
  let loggedAt = 0;
  while (Date.now() < deadline) {
    pending = sql("SELECT count(*) FROM messages WHERE status IN ('QUEUED', 'SENDING', 'SENT')");
    if (pending === '0') {
      return;
    }
    if (Date.now() - loggedAt >= 30_000) {
      loggedAt = Date.now();
      const counts = sql(
        `SELECT status || ':' || count(*) FROM messages WHERE "clientRef" LIKE 'load-%' GROUP BY status ORDER BY status`,
      );
      console.log(JSON.stringify({ pending: Number(pending), counts }));
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 5000);
    });
  }
  throw new Error(`Messages were still in flight after the drain window: ${pending}`);
}

const templateId = await prepare();
const result = await sendAll(templateId);
await drain();
const stored = Number(sql(`SELECT count(*) FROM messages WHERE "clientRef" LIKE 'load-%'`));
const nonTerminal = Number(
  sql("SELECT count(*) FROM messages WHERE status IN ('QUEUED', 'SENDING', 'SENT')"),
);
const doubles = Number(
  sql(
    `SELECT count(*) FROM (SELECT "refId" FROM ledger_entries WHERE type = 'CHARGE' AND "refId" IS NOT NULL GROUP BY "refId" HAVING count(*) > 1) doubled`,
  ),
);
const ledger = await call('/api/internal/admin/ledger/check', { method: 'POST' });
const lost = nonTerminal + Math.max(0, result.accepted - stored);
const ledgerDifferences = ledger.payload.differences.length;
console.log(
  JSON.stringify({
    accepted: result.accepted,
    rejected: result.rejected,
    elapsedMs: result.elapsedMs,
    lost,
    doubleCharges: doubles,
    ledgerDifferences,
  }),
);
if (
  result.accepted !== total ||
  result.rejected !== 0 ||
  lost !== 0 ||
  doubles !== 0 ||
  ledgerDifferences !== 0
) {
  process.exitCode = 1;
}
