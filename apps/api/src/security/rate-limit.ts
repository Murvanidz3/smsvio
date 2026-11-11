import { Injectable, Inject } from '@nestjs/common';
import { REDIS } from '@smsvio/server';
import { Redis } from 'ioredis';

import { ApiError } from '../http/api-error.js';
import { randomToken } from './tokens.js';

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export function decideRateLimit(
  count: number,
  limit: number,
  oldestScore: number | null,
  now: number,
  windowMs: number,
): RateLimitDecision {
  if (count <= limit) {
    return { allowed: true, retryAfterSeconds: 0 };
  }
  const retryMs = oldestScore === null ? windowMs : Math.max(1000, oldestScore + windowMs - now);
  return { allowed: false, retryAfterSeconds: Math.ceil(retryMs / 1000) };
}

@Injectable()
export class RateLimiter {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async hit(
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): Promise<RateLimitDecision> {
    const redisKey = `smsvio:rl:${key}`;
    const member = `${now.toString(36)}:${randomToken(6)}`;
    const results = await this.redis
      .multi()
      .zremrangebyscore(redisKey, 0, now - windowMs)
      .zadd(redisKey, now, member)
      .zcard(redisKey)
      .pexpire(redisKey, windowMs)
      .exec();
    if (results === null) {
      throw new ApiError(503, 'internal_error', 'Try again in a moment.');
    }
    const countEntry = results[2];
    const count =
      typeof countEntry?.[1] === 'number' ? countEntry[1] : Number(countEntry?.[1] ?? 0);
    const rawOldest =
      count > limit ? await this.redis.call('ZRANGE', redisKey, '0', '0', 'WITHSCORES') : [];
    const oldest = Array.isArray(rawOldest) ? rawOldest.map((entry) => String(entry)) : [];
    const oldestScore = oldest[1] === undefined ? null : Number(oldest[1]);
    return decideRateLimit(
      count,
      limit,
      Number.isFinite(oldestScore) ? oldestScore : null,
      now,
      windowMs,
    );
  }

  async enforce(key: string, limit: number, windowMs: number): Promise<void> {
    const decision = await this.hit(key, limit, windowMs);
    if (!decision.allowed) {
      throw new ApiError(
        429,
        'rate_limited',
        'Too many attempts. Try again later.',
        undefined,
        decision.retryAfterSeconds,
      );
    }
  }
}
