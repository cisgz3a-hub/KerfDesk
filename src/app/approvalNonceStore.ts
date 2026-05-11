/**
 * T1-136: pure approval-nonce store helpers extracted from
 * `MachineService.pruneConsumedApprovalNonces`. The consumed-nonce map
 * is the single-use guarantee behind T1-6 approval tokens — a nonce
 * minted by `requestApproval()` must only redeem ONE `sendCommand`
 * call. The pruner enforces two contracts:
 *
 *   1. Expired-by-TTL eviction. The approval-token TTL is 30 s; nonces
 *      whose `expiresAt` has passed are removed so the map doesn't
 *      grow without bound under normal usage.
 *   2. Hard-cap eviction. Even within the TTL window, the map is
 *      bounded at `MAX_CONSUMED_APPROVAL_NONCES` (default 512) with
 *      FIFO eviction so a flood of fast confirmations can't pin
 *      arbitrary memory.
 *
 * Pre-T1-136 these two rules lived inside a private method of the
 * 1924-line MachineService. The pruner is pure-on-the-Map (mutates a
 * Map argument, no `this` access, no singletons) which made testing
 * it require mounting the service AND injecting time. Post-T1-136 it
 * lives in this module and can be exercised with synthetic
 * Maps directly.
 *
 * Note: FIFO is exact — JavaScript `Map.prototype.keys()` is
 * insertion-ordered, so `keys().next().value` is always the oldest
 * still-present nonce. T1-136 preserves this property.
 */

/** Default cap on the consumed-nonce store (matches T1-6 in MachineService). */
export const DEFAULT_MAX_CONSUMED_APPROVAL_NONCES = 512;

/**
 * Prune `consumed`:
 *   1. Drop entries whose `expiresAt <= now`.
 *   2. If the remaining size exceeds `cap`, FIFO-evict from the head
 *      (oldest insertion) until the size is at-or-below cap.
 *
 * Mutates `consumed` in place. Returns nothing — callers inspect the
 * map's resulting size if needed.
 */
export function pruneApprovalNonceStore(
  consumed: Map<string, number>,
  now: number,
  cap: number = DEFAULT_MAX_CONSUMED_APPROVAL_NONCES,
): void {
  for (const [nonce, expiresAt] of consumed) {
    if (expiresAt <= now) {
      consumed.delete(nonce);
    }
  }

  while (consumed.size > cap) {
    const oldest = consumed.keys().next().value;
    if (typeof oldest !== 'string') break;
    consumed.delete(oldest);
  }
}
