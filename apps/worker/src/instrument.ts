// Loaded with `node --import` before the application so Sentry can hook into it.
import { initSentryFromEnv } from '@smsvio/server';

initSentryFromEnv('worker', process.env);
