/**
 * T2-36: subscription-based transport callbacks. Pre-T2-36 each
 * callback at `src/communication/WebSerialPort.ts:16-18` was a
 * single field that overwrote the previous via the setters at
 * `WebSerialPort.ts:60-70`. Acceptable for the current
 * single-controller design; problematic when:
 *   - a logger / audit wants to also see raw lines (only one
 *     consumer can subscribe today)
 *   - a simulator wants to mirror transport events
 *   - a lifecycle monitor wants to observe close events alongside
 *     the controller's handler
 *   - T2-34 (connection generation guard) needs multiple guarded
 *     subscribers
 *
 * Audit 3B section 3.7.
 *
 * T2-36 shipped a generic SubscriptionSet primitive + an
 * Unsubscribe type so transport implementations can swap the
 * single-slot fields for sets without rebuilding the publish loop on
 * every adopting site.
 *
 * Audit F-003 follow-up: `WebSerialPort` and `MockSerialPort` now use
 * SubscriptionSet for data/error/close listeners. The remaining
 * transport follow-up is the broader context-tag propagation for
 * per-event connection metadata.
 */

export type Unsubscribe = () => void;

export type Listener<A extends unknown[]> = (...args: A) => void;

/**
 * Bounded subscription registry. Iteration takes a snapshot before
 * dispatching so a listener that unsubscribes itself (or another
 * listener) during dispatch does not corrupt the iteration.
 *
 * Listener exceptions are caught and forwarded to `onListenerError`
 * (default: `console.error`) so one bad listener cannot prevent
 * the rest from receiving the event.
 */
export class SubscriptionSet<A extends unknown[]> {
  private readonly _listeners = new Set<Listener<A>>();
  private readonly _onListenerError: (error: unknown) => void;
  private _maxListeners: number | null;

  constructor(opts: {
    maxListeners?: number;
    onListenerError?: (error: unknown) => void;
  } = {}) {
    this._onListenerError = opts.onListenerError ?? ((e) => { console.error(e); });
    this._maxListeners = opts.maxListeners ?? null;
  }

  /**
   * Subscribe a listener. Returns an Unsubscribe closure that is
   * idempotent — calling it multiple times is safe.
   *
   * Throws if `maxListeners` is set and exceeded — bug surfacing,
   * not a silent leak. Subscribing the same listener twice is a
   * no-op (Set semantics) but does NOT throw.
   */
  subscribe(listener: Listener<A>): Unsubscribe {
    if (
      this._maxListeners != null &&
      !this._listeners.has(listener) &&
      this._listeners.size >= this._maxListeners
    ) {
      throw new Error(
        `SubscriptionSet: maxListeners=${this._maxListeners} exceeded — possible leak`,
      );
    }
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  /** True if the listener is currently subscribed. */
  has(listener: Listener<A>): boolean {
    return this._listeners.has(listener);
  }

  /** Number of currently-subscribed listeners. */
  get size(): number {
    return this._listeners.size;
  }

  /**
   * Dispatch to all subscribed listeners. A listener that throws
   * is reported via `onListenerError` and dispatch continues.
   * Listeners added during dispatch are NOT invoked for THIS event;
   * removed listeners ARE skipped if removed before they fire
   * (snapshot is iterated and `has()` checked).
   */
  dispatch(...args: A): void {
    if (this._listeners.size === 0) return;
    const snapshot = Array.from(this._listeners);
    for (const listener of snapshot) {
      if (!this._listeners.has(listener)) continue;
      try {
        listener(...args);
      } catch (err) {
        this._onListenerError(err);
      }
    }
  }

  /** Remove every subscriber. Used at transport teardown. */
  clear(): void {
    this._listeners.clear();
  }

  /** Adjust the maxListeners cap at runtime (or remove it). */
  setMaxListeners(n: number | null): void {
    this._maxListeners = n;
  }
}

/**
 * Multi-subscription wiring: aggregate several Unsubscribes into
 * one. Used by transport adopters that subscribe to data + error
 * + close at the same time.
 */
export function combineUnsubscribes(...unsubscribes: Unsubscribe[]): Unsubscribe {
  return (): void => {
    for (const u of unsubscribes) {
      try { u(); } catch { /* idempotent */ }
    }
  };
}

/**
 * Transport-shaped event listener types. Re-exported so
 * `WebSerialPort` adopters get one canonical place to import.
 *
 * `ctx` is the `TransportCallbackContext` from T2-34
 * (ConnectionGenerationGuard) — the connection generation tag
 * needed to drop stale microtask events. We re-declare the shape
 * here rather than importing it so this module is self-contained;
 * the duck-typing of `{ connectionId, generation }` is enforced by
 * each adopter's import-side narrowing.
 */
export interface TransportCtx {
  readonly connectionId: string;
  readonly generation: number;
}

export type DataListener = Listener<[line: string, ctx: TransportCtx]>;
export type ErrorListener = Listener<[error: Error, ctx: TransportCtx]>;
export type CloseListener = Listener<[ctx: TransportCtx]>;
