// Container health check: exits 0 when this instance's heartbeat in Redis is fresh.
import { errorMessage } from '@smsvio/shared';
import { Redis } from 'ioredis';

import { loadWorkerEnv } from './env.js';
import { defaultInstanceId, heartbeatKey, isHeartbeatFresh } from './heartbeat.js';

const env = loadWorkerEnv(process.env);
const redis = new Redis(env.REDIS_URL, {
  connectionName: 'smsvio-worker-healthcheck',
  maxRetriesPerRequest: 1,
  connectTimeout: 3000,
  retryStrategy: () => null,
});

try {
  const value = await redis.get(heartbeatKey(defaultInstanceId()));
  const fresh = isHeartbeatFresh(value, Date.now(), env.WORKER_HEARTBEAT_INTERVAL_MS);
  if (!fresh) {
    process.stderr.write('worker heartbeat missing or stale\n');
  }
  process.exitCode = fresh ? 0 : 1;
} catch (error) {
  process.stderr.write(`worker health check failed: ${errorMessage(error)}\n`);
  process.exitCode = 1;
} finally {
  redis.disconnect();
}
