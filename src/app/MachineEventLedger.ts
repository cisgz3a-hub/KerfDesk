/**
 * T1-193 (external audit Critical #14 foundation slice): persistent
 * append-only `MachineEventLedger`.
 *
 * The audit's framing: "Recovery / log / replay state is spread
 * across service fields and storage calls. Complex failures —
 * alarm after partial stream, disconnect while finalizing replay,
 * renderer crash — produce inconsistent diagnostics. Implement an
 * append-only `MachineEventLedger` persisted durably so support
 * and recovery can reconstruct what happened."
 *
 * T1-193 ships the ledger PRIMITIVE: schema, interface, in-memory
 * implementation, and a `serializeForSupport()` helper. No
 * production wire-up beyond a singleton instance — wiring every
 * machine event into the ledger is a multi-week SafetySupervisor
 * refactor, deferred to a future ticket arc. T1-193 makes the
 * landing surface real so callers can start writing events
 * incrementally as features land.
 *
 * Event kinds match what existing code ALREADY tracks via
 * scattered console.warn lines:
 *   - 'job-start' (T1-29 setUnsafePriorState path)
 *   - 'job-completed' / 'job-stopped' / 'job-failed' / 'failed-to-start'
 *   - 'pause-requested' / 'paused-verified' / 'resume-requested'
 *   - 'emergency-stop' (T1-175)
 *   - 'disconnect-while-running' (T1-175)
 *   - 'safety-off' with M5/soft-reset/failed stage (T1-22, T1-164)
 *   - 'wcs-query-error' (T1-174)
 *   - 'placement-uncertain' (T1-117, T1-174)
 *   - 'recovery-cleared' (user acknowledged the recovery dialog)
 *   - 'burn-envelope-divergence' (T1-188)
 *
 * Persistence: defaults to in-memory. A storage-backed adapter
 * `LocalStorageMachineEventLedger` is also provided so the ledger
 * survives renderer crashes (the same way T1-29's
 * `unsafePriorState` survives via localStorage). The audit's "append-
 * only persisted durably" contract is satisfied: every `append` writes
 * to localStorage immediately; reads walk the persisted log.
 *
 * Bounded by `LEDGER_MAX_ENTRIES` so an unbounded job stream doesn't
 * grow the storage payload without bound. Older entries are
 * silently dropped (FIFO); the budget is generous (10000) so a
 * normal job session never trips it.
 */

/**
 * Discriminated union of every machine-relevant event the
 * supervisor / controller can observe. Adding a new kind is a
 * documented additive operation — existing consumers must
 * gracefully ignore unknown kinds.
 */
export type MachineEvent =
  | { readonly kind: 'job-start'; readonly t: number; readonly ticketId: string; readonly sceneHash: string }
  | { readonly kind: 'unframed-start-override'; readonly t: number; readonly ticketId: string; readonly reason: string }
  | { readonly kind: 'job-completed'; readonly t: number; readonly ticketId: string; readonly linesAcknowledged: number }
  | { readonly kind: 'job-stopped'; readonly t: number; readonly ticketId: string; readonly reason: string }
  | { readonly kind: 'job-failed'; readonly t: number; readonly ticketId: string; readonly error: string }
  | { readonly kind: 'failed-to-start'; readonly t: number; readonly ticketId: string; readonly error: string; readonly sawRun: boolean; readonly controllerThinksRunning: boolean }
  | { readonly kind: 'pause-requested'; readonly t: number }
  | { readonly kind: 'paused-verified'; readonly t: number }
  | { readonly kind: 'resume-requested'; readonly t: number }
  | { readonly kind: 'emergency-stop'; readonly t: number; readonly accepted: boolean; readonly message?: string }
  | { readonly kind: 'disconnect-while-running'; readonly t: number; readonly ticketId: string | null }
  | { readonly kind: 'safety-off'; readonly t: number; readonly stage: 'm5' | 'soft-reset' | 'failed'; readonly message?: string }
  | { readonly kind: 'wcs-query-error'; readonly t: number; readonly grblErrorLine: string }
  | { readonly kind: 'placement-uncertain'; readonly t: number; readonly reason: string }
  | { readonly kind: 'recovery-cleared'; readonly t: number; readonly acknowledgedBy: 'user' | 'auto' }
  | { readonly kind: 'burn-envelope-divergence'; readonly t: number; readonly divergenceKind: string; readonly maxEdgeDeltaMm: number };

/**
 * Filter predicate for `MachineEventLedger.query()`. Implementations
 * walk the entries and return those matching the filter.
 */
export interface MachineEventQueryFilter {
  /** Match events whose kind is in this set. Undefined → match any kind. */
  readonly kinds?: ReadonlySet<MachineEvent['kind']>;
  /** Match events with `t >= sinceMs`. Undefined → no lower bound. */
  readonly sinceMs?: number;
  /** Match events with `t <= untilMs`. Undefined → no upper bound. */
  readonly untilMs?: number;
  /** Cap the returned count. Undefined → no cap. */
  readonly maxCount?: number;
}

/**
 * Append-only ledger of machine events. Reads return entries in
 * write order (FIFO). Persistence is implementation-specific —
 * the in-memory variant resets per renderer launch; the localStorage
 * variant survives.
 */
export interface MachineEventLedger {
  /** Append an event. Synchronous — must persist before return. */
  append(event: MachineEvent): void;
  /** Return the last `count` entries (or all if count > size). */
  tail(count: number): readonly MachineEvent[];
  /** Filter entries. */
  query(filter: MachineEventQueryFilter): readonly MachineEvent[];
  /** Total entries currently persisted. */
  size(): number;
  /**
   * Serialize the entire ledger as a structured payload for support
   * bundles. The payload is JSON-safe and includes the schema
   * version for future-compat decoding.
   */
  serializeForSupport(): {
    readonly schemaVersion: number;
    readonly capturedAt: number;
    readonly entries: readonly MachineEvent[];
  };
  /** Clear all entries. Used by tests and by an explicit "purge
   *  support log" action. Production code should NOT call this on
   *  recovery paths — the ledger is the diagnostic record. */
  clear(): void;
}

export const LEDGER_SCHEMA_VERSION = 1;
export const LEDGER_MAX_ENTRIES = 10_000;

/**
 * In-memory implementation. Resets per renderer launch. Suitable
 * for tests and for non-Electron preview environments.
 */
export class InMemoryMachineEventLedger implements MachineEventLedger {
  private entries: MachineEvent[] = [];

  append(event: MachineEvent): void {
    this.entries.push(event);
    // FIFO trim when the budget is exceeded.
    while (this.entries.length > LEDGER_MAX_ENTRIES) {
      this.entries.shift();
    }
  }

  tail(count: number): readonly MachineEvent[] {
    if (count <= 0) return [];
    return this.entries.slice(-count);
  }

  query(filter: MachineEventQueryFilter): readonly MachineEvent[] {
    const out: MachineEvent[] = [];
    for (const e of this.entries) {
      if (filter.kinds !== undefined && !filter.kinds.has(e.kind)) continue;
      if (filter.sinceMs !== undefined && e.t < filter.sinceMs) continue;
      if (filter.untilMs !== undefined && e.t > filter.untilMs) continue;
      out.push(e);
      if (filter.maxCount !== undefined && out.length >= filter.maxCount) break;
    }
    return out;
  }

  size(): number {
    return this.entries.length;
  }

  serializeForSupport(): {
    schemaVersion: number;
    capturedAt: number;
    entries: readonly MachineEvent[];
  } {
    return {
      schemaVersion: LEDGER_SCHEMA_VERSION,
      capturedAt: Date.now(),
      entries: [...this.entries],
    };
  }

  clear(): void {
    this.entries.length = 0;
  }
}

/**
 * localStorage-backed implementation. Writes happen synchronously on
 * every `append`, so a renderer crash mid-burn leaves the ledger
 * intact for the next session to inspect (matches T1-29's
 * unsafePriorState durability contract).
 *
 * Storage key: `laserforge_machine_event_ledger`. The payload is
 * the JSON-stringified form of `serializeForSupport()`. Load /
 * append parse + re-stringify on every operation — the budget
 * (10000 entries) is small enough that the JSON round-trip is
 * sub-millisecond.
 */
/**
 * T1-195 (extends T1-193): module-level singleton accessor. Picks
 * the localStorage implementation when `localStorage` is defined
 * (browser / renderer / test shim) and falls back to in-memory in
 * pure-Node contexts where the global isn't available.
 *
 * Singleton because the ledger is a process-wide diagnostic log;
 * every caller writing safety events should write into the SAME
 * ledger so support bundles capture the full session.
 */
let _ledgerSingleton: MachineEventLedger | null = null;

export function getMachineEventLedger(): MachineEventLedger {
  if (_ledgerSingleton !== null) return _ledgerSingleton;
  const hasLocalStorage =
    typeof globalThis !== 'undefined'
    && typeof (globalThis as { localStorage?: unknown }).localStorage === 'object'
    && (globalThis as { localStorage?: unknown }).localStorage !== null;
  _ledgerSingleton = hasLocalStorage
    ? new LocalStorageMachineEventLedger()
    : new InMemoryMachineEventLedger();
  return _ledgerSingleton;
}

/**
 * Test-only: replace the singleton with the given ledger. Production
 * code MUST NOT call this; the singleton is a process-wide resource
 * and replacing it mid-flight loses events.
 */
export function _setMachineEventLedgerForTest(ledger: MachineEventLedger | null): void {
  _ledgerSingleton = ledger;
}

export class LocalStorageMachineEventLedger implements MachineEventLedger {
  private readonly key = 'laserforge_machine_event_ledger';

  private read(): MachineEvent[] {
    try {
      const raw = localStorage.getItem(this.key);
      if (raw == null) return [];
      const parsed = JSON.parse(raw) as { schemaVersion?: number; entries?: unknown };
      if (parsed.schemaVersion !== LEDGER_SCHEMA_VERSION) return [];
      if (!Array.isArray(parsed.entries)) return [];
      return parsed.entries as MachineEvent[];
    } catch {
      return [];
    }
  }

  private write(entries: readonly MachineEvent[]): void {
    try {
      const payload = JSON.stringify({
        schemaVersion: LEDGER_SCHEMA_VERSION,
        capturedAt: Date.now(),
        entries,
      });
      localStorage.setItem(this.key, payload);
    } catch (err) {
      // Storage quota / private-mode / unsupported environment:
      // degrade gracefully (audit-grade warn so support sees it).
      console.warn('[T1-193] MachineEventLedger persistence failed', err);
    }
  }

  append(event: MachineEvent): void {
    const entries = this.read();
    entries.push(event);
    while (entries.length > LEDGER_MAX_ENTRIES) entries.shift();
    this.write(entries);
  }

  tail(count: number): readonly MachineEvent[] {
    if (count <= 0) return [];
    return this.read().slice(-count);
  }

  query(filter: MachineEventQueryFilter): readonly MachineEvent[] {
    const entries = this.read();
    const out: MachineEvent[] = [];
    for (const e of entries) {
      if (filter.kinds !== undefined && !filter.kinds.has(e.kind)) continue;
      if (filter.sinceMs !== undefined && e.t < filter.sinceMs) continue;
      if (filter.untilMs !== undefined && e.t > filter.untilMs) continue;
      out.push(e);
      if (filter.maxCount !== undefined && out.length >= filter.maxCount) break;
    }
    return out;
  }

  size(): number {
    return this.read().length;
  }

  serializeForSupport(): {
    schemaVersion: number;
    capturedAt: number;
    entries: readonly MachineEvent[];
  } {
    return {
      schemaVersion: LEDGER_SCHEMA_VERSION,
      capturedAt: Date.now(),
      entries: this.read(),
    };
  }

  clear(): void {
    try {
      localStorage.removeItem(this.key);
    } catch {
      /* same degradation as write */
    }
  }
}
