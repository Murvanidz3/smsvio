import type { MembershipRole } from './constants.js';

export const CAPABILITIES = {
  /** See every dashboard page and record in the organization. */
  view: ['OWNER', 'ADMIN', 'DEVELOPER', 'BILLING', 'VIEWER'],
  /** Send messages and manage templates and contacts (enforced when those features exist). */
  messaging: ['OWNER', 'ADMIN', 'DEVELOPER'],
  /** API keys and webhooks. */
  developer: ['OWNER', 'ADMIN', 'DEVELOPER'],
  /** Sender IDs and compliance. */
  compliance: ['OWNER', 'ADMIN'],
  /** Balance, top-ups and billing settings. */
  billing: ['OWNER', 'ADMIN', 'BILLING'],
  /** Team members and organization settings. */
  manage: ['OWNER', 'ADMIN'],
  /** Transfer ownership and delete the organization. */
  own: ['OWNER'],
} as const satisfies Record<string, readonly MembershipRole[]>;

export type Capability = keyof typeof CAPABILITIES;

export function roleAllows(role: MembershipRole, capability: Capability): boolean {
  return (CAPABILITIES[capability] as readonly MembershipRole[]).includes(role);
}
