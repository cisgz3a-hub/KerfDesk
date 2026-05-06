/**
 * T2-34: connection generation guard. Pre-T2-34 read-loop callbacks
 * at `src/communication/WebSerialPort.ts:122-159` had no connection
 * ID, and `GrblController.connect` (`src/controllers/grbl/
 * GrblController.ts:182-330`) registered callbacks without a
 * generation tag. After a rapid disconnect/reconnect:
 *   - old WebSerialPort instance may still have a read-loop event in
 *     the microtask queue
 *   - old `_dataCallback` may still point to the old controller
 *   - the old controller may have already been disconnected and
 *     replaced
 *
 * Audit 3B section 9.4 + 8.4 + 3.8. Industry-standard fix: tag every
 * transport callback with the `connectionId` it was registered
 * against; listeners drop events whose connectionId ≠ active.
 *
 * T2-34 ships the pure primitive (allocator + token + isStale check
 * + guard wrapper) so transport implementations and controllers can
 * adopt it without coordinating on a single connectionId source.
 * Wiring `WebSerialPort.onData/onError/onClose` + GrblController to
 * accept and forward `TransportCallbackContext` is filed as
 * T2-34-followup.
 */

export interface ConnectionToken {
  readonly id: string;
  readonly generation: number;
  readonly createdAt: number;
}

export interface TransportCallbackContext {
  readonly connectionId: string;
  readonly generation: number;
}

/**
 * Allocator. Each `allocate()` call returns a token whose
 * `generation` strictly increases. `id` is a stable string of the
 * form `conn-<generation>` for log readability — the generation
 * number is the load-bearing invariant.
 */
export class ConnectionGenerationAllocator {
  private _nextGeneration: number;
  private readonly _now: () => number;

  constructor(opts: { startGeneration?: number; now?: () => number } = {}) {
    this._nextGeneration = opts.startGeneration ?? 1;
    this._now = opts.now ?? Date.now;
  }

  allocate(): ConnectionToken {
    const generation = this._nextGeneration++;
    return {
      id: `conn-${generation}`,
      generation,
      createdAt: this._now(),
    };
  }

  get nextGeneration(): number {
    return this._nextGeneration;
  }
}

/**
 * Pure staleness check. An event with `ctx` is stale relative to
 * `active` if the contexts differ in generation OR id. Returns true
 * when the event SHOULD be dropped.
 */
export function isStaleContext(
  ctx: TransportCallbackContext,
  active: ConnectionToken | null,
): boolean {
  if (active == null) return true;
  if (ctx.generation !== active.generation) return true;
  if (ctx.connectionId !== active.id) return true;
  return false;
}

/** Convenience: build a context from a token. */
export function contextFromToken(token: ConnectionToken): TransportCallbackContext {
  return { connectionId: token.id, generation: token.generation };
}

/**
 * Wrap a callback so it becomes a no-op when the bound token is no
 * longer the active one. The wrapper takes `getActive` (a closure
 * over the controller's current token) so the gate updates as
 * connections are replaced.
 */
export function withGenerationGuard<A extends unknown[]>(
  bound: ConnectionToken,
  getActive: () => ConnectionToken | null,
  callback: (...args: A) => void,
): (...args: A) => void {
  return (...args: A): void => {
    const active = getActive();
    if (isStaleContext(contextFromToken(bound), active)) return;
    callback(...args);
  };
}

/**
 * Two-pass guard: callback receives a `TransportCallbackContext`
 * argument (typical for transports that propagate it). Drops the
 * event if its ctx is stale relative to `getActive()`.
 */
export function guardCallback<A extends unknown[]>(
  getActive: () => ConnectionToken | null,
  callback: (...args: A) => void,
): (ctx: TransportCallbackContext, ...args: A) => void {
  return (ctx: TransportCallbackContext, ...args: A): void => {
    if (isStaleContext(ctx, getActive())) return;
    callback(...args);
  };
}

/**
 * Comparator for testing token age — newer generation wins. Returns
 * positive when `a` is newer than `b`, 0 when equal, negative when
 * older.
 */
export function compareTokens(a: ConnectionToken, b: ConnectionToken): number {
  return a.generation - b.generation;
}

/**
 * The guard reason — used by diagnostics so we can tell why an
 * event was dropped (no active connection vs. mismatch).
 */
export type StaleEventReason =
  | 'no-active-connection'
  | 'generation-mismatch'
  | 'id-mismatch'
  | 'live';

export function classifyContext(
  ctx: TransportCallbackContext,
  active: ConnectionToken | null,
): StaleEventReason {
  if (active == null) return 'no-active-connection';
  if (ctx.generation !== active.generation) return 'generation-mismatch';
  if (ctx.connectionId !== active.id) return 'id-mismatch';
  return 'live';
}
