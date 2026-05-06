/**
 * T2-68: critical error history preserved across `clearMessages()`
 * and disconnect. Pre-T2-68 disconnect at
 * `src/ui/components/ConnectionPanelMain.tsx:582` called
 * `clearMessages()` unconditionally — if a user disconnected
 * after a job failure to reconnect for diagnosis, the message log
 * explaining what failed was wiped. Same pattern fired across any
 * clear-messages flow.
 *
 * Audit 4C Visibility 2 + Logging 2 + Required Priority 7.
 *
 * T2-68 ships the two-store split (session messages + critical
 * events + last-by-domain index) with deterministic-friendly id
 * generation, bounded retention, and (de)serialisation helpers
 * for storage persistence. Wiring `reportError` (T2-65) routing
 * + UI "Last problem" surface is filed as T2-68-followup.
 */

import type { ErrorDomain, ErrorSeverity, UserFacingError } from './ErrorReporter';

export interface CriticalEvent {
  readonly id: string;
  readonly timestamp: number;
  readonly domain: ErrorDomain;
  readonly severity: 'error' | 'critical';
  readonly title: string;
  readonly message: string;
  readonly recoverySteps?: readonly string[];
  readonly developerDetails?: unknown;
}

/** True for severities that must survive session-clearing operations. */
export function isCriticalSeverity(s: ErrorSeverity): s is 'error' | 'critical' {
  return s === 'error' || s === 'critical';
}

/**
 * Convert a UserFacingError (T2-65) to a CriticalEvent for the
 * preserved store. Returns null for severities that don't qualify
 * (info / warning go to session log only).
 */
export function eventFromError(err: UserFacingError): CriticalEvent | null {
  if (!isCriticalSeverity(err.severity)) return null;
  return {
    id: err.id,
    timestamp: err.timestamp,
    domain: err.domain,
    severity: err.severity,
    title: err.title,
    message: err.message,
    recoverySteps: err.recoverySteps,
    developerDetails: err.developerDetails,
  };
}

export interface CriticalEventStoreOptions {
  /** Max events to retain. Audit suggests 200; default 200. */
  readonly maxEvents?: number;
  /** Clock injection for deterministic tests. */
  readonly now?: () => number;
}

/**
 * Two-track store. `record(event)` appends to the bounded events
 * array AND updates `lastByDomain`. The session-clearing helper
 * (whose name lives in the session-message owner, not here) is
 * deliberately NOT a method on this class — its absence is the
 * contract.
 *
 * Subscribers are notified via `onChange`; replays are not done
 * (single source of truth — caller can re-read getEvents()).
 */
export class CriticalEventStore {
  private readonly _events: CriticalEvent[] = [];
  private readonly _lastByDomain: Map<ErrorDomain, CriticalEvent> = new Map();
  private readonly _listeners: Set<() => void> = new Set();
  private readonly _maxEvents: number;

  constructor(opts: CriticalEventStoreOptions = {}) {
    this._maxEvents = opts.maxEvents ?? 200;
  }

  record(event: CriticalEvent): void {
    this._events.push(event);
    if (this._events.length > this._maxEvents) {
      this._events.splice(0, this._events.length - this._maxEvents);
    }
    this._lastByDomain.set(event.domain, event);
    this._notify();
  }

  /** Pull-shaped read; returns a snapshot copy. */
  getEvents(): readonly CriticalEvent[] {
    return [...this._events];
  }

  /** Most recent critical event per domain, ordered most-recent-first. */
  getLastByDomain(): readonly CriticalEvent[] {
    return Array.from(this._lastByDomain.values())
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  getLastForDomain(domain: ErrorDomain): CriticalEvent | null {
    return this._lastByDomain.get(domain) ?? null;
  }

  size(): number {
    return this._events.length;
  }

  /** Subscriber pub-sub. Returns Unsubscribe. */
  onChange(cb: () => void): () => void {
    this._listeners.add(cb);
    return () => { this._listeners.delete(cb); };
  }

  /**
   * Explicit purge. The session-message helper does NOT call this —
   * the caller has to take ownership when they want to reset.
   */
  clearAll(): void {
    this._events.length = 0;
    this._lastByDomain.clear();
    this._notify();
  }

  /** Hydrate from persisted JSON (e.g. localStorage on app boot). */
  hydrate(events: readonly CriticalEvent[]): void {
    for (const e of events) this.record(e);
  }

  /** Serialisable form for localStorage / IndexedDB. */
  toJSON(): { version: 1; events: readonly CriticalEvent[] } {
    return { version: 1, events: this._events };
  }

  private _notify(): void {
    for (const l of this._listeners) {
      try { l(); } catch (e) { console.warn('CriticalEventStore listener threw', e); }
    }
  }
}

/**
 * Audit-derived "Last problem" UI summary. Returns the most-recent
 * critical event with a "N seconds/minutes/hours ago" relative
 * timestamp. Returns null when nothing critical has happened.
 */
export function describeLastProblem(
  store: CriticalEventStore,
  now: number = Date.now(),
): { event: CriticalEvent; relativeAgo: string } | null {
  const all = store.getLastByDomain();
  if (all.length === 0) return null;
  const event = all[0];
  return {
    event,
    relativeAgo: formatAgo(now - event.timestamp),
  };
}

function formatAgo(deltaMs: number): string {
  const seconds = Math.max(0, Math.floor(deltaMs / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'} ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
