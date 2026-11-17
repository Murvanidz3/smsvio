import type { AuthState } from '../accounts/support.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthState;
    apiKey?: { id: string; mode: 'LIVE' | 'TEST'; organizationId: string };
  }
}
