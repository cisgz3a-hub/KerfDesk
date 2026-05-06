/**
 * T2-65: central error reporter — `reportError({domain, severity,
 * recovery, developerDetails})`. Pre-T2-65 errors were scattered
 * across `appendMessage(...)` / `showAlert(...)` / `console.warn(...)`
 * / silent `.catch(() => {})` patterns — the same class of error got
 * different visibility depending on which file the catch lived in.
 *
 * Audit 4C Required Priority 1 + Critical 1 + refines T2-57 (which
 * covers the durable state side; T2-65 covers the API side). T2-65
 * is the SINGLE API every catch block calls; severity decides where
 * to surface.
 *
 * T2-65 ships the type + the reporter class + the singleton + the
 * `reportError` helper. Migrating the existing call sites
 * (`appendMessage` / `showAlert` / `console.warn`) is filed as
 * T2-65-followup so each site gets its severity/domain classification
 * reviewed individually.
 *
 * Pairs with T2-114's `installGlobalErrorHandlers` (shipped in
 * `fec932f`) — that catches uncaught errors at the window level;
 * T2-65 is the typed first-class API for code that catches
 * intentionally.
 */

export type ErrorDomain =
  | 'connection' | 'machine' | 'job' | 'compile'
  | 'import' | 'project' | 'system' | 'safety' | 'storage';

export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

/**
 * Where the reporter should surface this error. Severity routing
 * defaults are documented per-kind on `surfacesFor`. Tests can
 * override via the input.
 */
export type ErrorSurface = 'log' | 'toast' | 'banner' | 'modal' | 'console';

export interface UserFacingError {
  id: string;
  timestamp: number;
  domain: ErrorDomain;
  severity: ErrorSeverity;
  title: string;
  message: string;
  /** Step-by-step recovery instructions; UI renders as numbered list. */
  recoverySteps?: string[];
  /** Side-effect hints — invalidate frame/compile, mark position untrusted, gate Start. */
  invalidatesFrame?: boolean;
  invalidatesCompile?: boolean;
  affectsPositionTrust?: boolean;
  blocksStart?: boolean;
  /** Logged-only payload for support diagnostics; not user-facing. */
  developerDetails?: unknown;
  /** When true, the error has already been resolved and listeners
   *  may downgrade it (e.g. clear a banner). */
  resolved?: boolean;
}

export type ErrorListener = (e: UserFacingError) => void;

/**
 * Default surface routing per severity.
 *   - info → console only (developer-facing)
 *   - warning → log + toast (visible but non-blocking)
 *   - error → log + persistent banner (visible until dismissed)
 *   - critical → log + modal + persistent banner (interrupts)
 */
export function surfacesFor(severity: ErrorSeverity): ReadonlyArray<ErrorSurface> {
  switch (severity) {
    case 'info': return ['console'];
    case 'warning': return ['log', 'toast'];
    case 'error': return ['log', 'banner'];
    case 'critical': return ['log', 'modal', 'banner'];
  }
}

let _idCounter = 0;
function isDeterministic(): boolean {
  if (typeof process !== 'undefined' && process.env?.LASERFORGE_DETERMINISTIC_IDS === '1') return true;
  if (typeof globalThis !== 'undefined') {
    return (globalThis as { __LF_DETERMINISTIC_IDS__?: boolean }).__LF_DETERMINISTIC_IDS__ === true;
  }
  return false;
}

export function generateErrorId(now: number): string {
  if (isDeterministic()) {
    _idCounter += 1;
    return `err_det_${String(_idCounter).padStart(6, '0')}`;
  }
  const suffix = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return `err_${now}_${suffix}`;
}

export function resetErrorIdCounter(): void {
  _idCounter = 0;
}

export class ErrorReporter {
  private listeners = new Set<ErrorListener>();
  /** Bounded retention so the in-memory log doesn't grow unbounded. */
  private history: UserFacingError[] = [];
  private maxHistory = 200;

  /** Override defaults — used by tests + the support bundle assembler. */
  setMaxHistory(n: number): void {
    this.maxHistory = Math.max(1, Math.floor(n));
    while (this.history.length > this.maxHistory) this.history.shift();
  }

  subscribe(l: ErrorListener): () => void {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }

  /**
   * Get a snapshot of recent errors. Returns NEWEST-LAST for chronological
   * UI rendering. Filter by `domain` to return only that subset.
   */
  getHistory(domain?: ErrorDomain): ReadonlyArray<UserFacingError> {
    if (!domain) return [...this.history];
    return this.history.filter((e) => e.domain === domain);
  }

  /** Test-only: clear history + listeners. */
  destroyForTests(): void {
    this.listeners.clear();
    this.history = [];
  }

  /**
   * Report an error. Allocates id + timestamp, appends to history
   * (bounded), invokes every listener. Listener exceptions are
   * isolated so a broken consumer cannot block the others.
   */
  report(
    input: Omit<UserFacingError, 'id' | 'timestamp'>,
    now: number = Date.now(),
  ): UserFacingError {
    const error: UserFacingError = {
      id: generateErrorId(now),
      timestamp: now,
      ...input,
    };
    this.history.push(error);
    if (this.history.length > this.maxHistory) this.history.shift();
    for (const l of this.listeners) {
      try { l(error); } catch { /* swallow */ }
    }
    return error;
  }

  /**
   * Mark a previously-reported error as resolved (e.g. the
   * connection that was 'failed' is now 'connected'). Replays a
   * `resolved: true` copy through listeners so banners/toasts
   * dismiss themselves.
   */
  resolve(errorId: string): boolean {
    const idx = this.history.findIndex((e) => e.id === errorId);
    if (idx < 0) return false;
    const updated: UserFacingError = { ...this.history[idx], resolved: true };
    this.history[idx] = updated;
    for (const l of this.listeners) {
      try { l(updated); } catch { /* swallow */ }
    }
    return true;
  }
}

/**
 * Singleton consumed by `reportError`. Tests construct fresh
 * `ErrorReporter` instances when isolation matters.
 */
export const errorReporter = new ErrorReporter();

/**
 * Convenience entry point. Migration target: every existing
 * `appendMessage` / `showAlert` / `console.warn` site converts to
 * a `reportError({...})` call.
 */
export function reportError(
  input: Omit<UserFacingError, 'id' | 'timestamp'>,
): UserFacingError {
  return errorReporter.report(input);
}

/**
 * Build a UserFacingError from a thrown value (Error or arbitrary
 * `unknown`). Used by catch sites that don't want to enumerate
 * fields manually:
 *
 *   try { ... } catch (err) {
 *     reportError(errorFromCatch('compile', 'error', 'Compile failed', err));
 *   }
 */
export function errorFromCatch(
  domain: ErrorDomain,
  severity: ErrorSeverity,
  title: string,
  caught: unknown,
): Omit<UserFacingError, 'id' | 'timestamp'> {
  const message = caught instanceof Error ? caught.message
    : typeof caught === 'string' ? caught
    : 'An unknown error occurred.';
  const developerDetails = caught instanceof Error
    ? { name: caught.name, stack: caught.stack, message: caught.message }
    : caught;
  return { domain, severity, title, message, developerDetails };
}
