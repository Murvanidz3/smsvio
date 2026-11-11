export const LEDGER_TYPES = ['TOPUP', 'HOLD', 'CHARGE', 'RELEASE', 'REFUND', 'ADJUSTMENT'] as const;

export type LedgerType = (typeof LEDGER_TYPES)[number];

export interface LedgerSnapshot {
  readonly organizationId: string;
  readonly type: LedgerType;
  readonly amountMicros: bigint;
  readonly refId: string | null;
}

export interface BalanceSnapshot {
  readonly organizationId: string;
  readonly availableMicros: bigint;
  readonly heldMicros: bigint;
}

export interface LedgerDifference {
  readonly organizationId: string;
  readonly availableMicros: bigint;
  readonly heldMicros: bigint;
  readonly ledgerAvailableMicros: bigint;
  readonly ledgerHeldMicros: bigint;
}

/**
 * Available balance is the sum of every entry except CHARGE.
 * CHARGE records the price that left `held` and does not move `available`.
 * Held is the open remainder of HOLD, RELEASE and CHARGE rows that share a refId.
 */
export function ledgerDifferences(
  balances: readonly BalanceSnapshot[],
  entries: readonly LedgerSnapshot[],
): LedgerDifference[] {
  const available = new Map<string, bigint>();
  const heldByRef = new Map<string, Map<string, bigint>>();
  for (const entry of entries) {
    if (entry.type !== 'CHARGE') {
      available.set(
        entry.organizationId,
        (available.get(entry.organizationId) ?? 0n) + entry.amountMicros,
      );
    }
    const movement = heldMovement(entry);
    if (movement !== 0n) {
      const refs = heldByRef.get(entry.organizationId) ?? new Map<string, bigint>();
      const refId = entry.refId ?? '';
      refs.set(refId, (refs.get(refId) ?? 0n) + movement);
      heldByRef.set(entry.organizationId, refs);
    }
  }
  const heldByOrg = new Map<string, bigint>();
  for (const [organizationId, refs] of heldByRef) {
    let sum = 0n;
    for (const value of refs.values()) {
      sum += value;
    }
    heldByOrg.set(organizationId, sum);
  }
  const seen = new Set<string>();
  const differences: LedgerDifference[] = [];
  for (const balance of balances) {
    seen.add(balance.organizationId);
    pushDifference(differences, balance.organizationId, balance, available, heldByOrg);
  }
  for (const organizationId of available.keys()) {
    if (!seen.has(organizationId)) {
      pushDifference(differences, organizationId, null, available, heldByOrg);
    }
  }
  for (const organizationId of heldByOrg.keys()) {
    if (!seen.has(organizationId) && !available.has(organizationId)) {
      pushDifference(differences, organizationId, null, available, heldByOrg);
    }
  }
  return differences;
}

function heldMovement(entry: LedgerSnapshot): bigint {
  if (entry.type === 'HOLD') {
    return -entry.amountMicros;
  }
  if (entry.type === 'RELEASE') {
    return -entry.amountMicros;
  }
  if (entry.type === 'CHARGE') {
    return entry.amountMicros;
  }
  return 0n;
}

function pushDifference(
  differences: LedgerDifference[],
  organizationId: string,
  balance: BalanceSnapshot | null,
  available: ReadonlyMap<string, bigint>,
  held: ReadonlyMap<string, bigint>,
): void {
  const ledgerAvailable = available.get(organizationId) ?? 0n;
  const ledgerHeld = held.get(organizationId) ?? 0n;
  const storedAvailable = balance?.availableMicros ?? 0n;
  const storedHeld = balance?.heldMicros ?? 0n;
  if (storedAvailable === ledgerAvailable && storedHeld === ledgerHeld && balance !== null) {
    return;
  }
  if (balance === null && ledgerAvailable === 0n && ledgerHeld === 0n) {
    return;
  }
  differences.push({
    organizationId,
    availableMicros: storedAvailable,
    heldMicros: storedHeld,
    ledgerAvailableMicros: ledgerAvailable,
    ledgerHeldMicros: ledgerHeld,
  });
}
