import type { AuthState } from '../accounts/support.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthState;
  }
}
