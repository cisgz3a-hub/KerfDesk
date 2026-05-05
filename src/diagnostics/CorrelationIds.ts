/**
 * T2-117: explicit `CorrelationIds` type + ID generation. Pre-T2-117
 * the codebase had per-subsystem IDs (`JobLog.id`, `ValidatedJobTicket.
 * ticketId`) but no top-level session ID, no project ID, no compile ID,
 * no frame ID, and no support bundle ID. Audit 5C Required Priority 14
 * notes: support workflows need to correlate events across subsystems
 * ("user reported job failed at 14:32 — was it the same compile that
 * the preflight ran against?"). Without correlation IDs the support
 * engineer reconstructs timelines by hand.
 *
 * T2-117 is the focused MVP: the type, the generator, and a context-
 * snapshot helper. Threading the snapshot through `reportError`,
 * `JobLog`, crash reports, and the support bundle is filed as
 * T2-117-followup since each touches an already-shipped contract.
 */
export type CorrelationIdPrefix =
  | 'session'
  | 'project'
  | 'compile'
  | 'preflight'
  | 'frame'
  | 'job'
  | 'bundle';

export interface CorrelationIds {
  sessionId: string;
  projectId: string | null;
  compileId: string | null;
  preflightId: string | null;
  frameId: string | null;
  jobId: string | null;
  supportBundleId: string | null;
}

/**
 * Generate a correlation ID. Format:
 *   `${prefix}_${unixMs}_${6-char-suffix}`
 *
 * The unixMs is included so support engineers eyeballing a bundle can
 * sort events by ID and get a near-chronological order without a wall-
 * clock lookup. The 6-char suffix breaks ties when two IDs are
 * generated in the same millisecond.
 *
 * Honours `LASERFORGE_DETERMINISTIC_IDS=1` for tests so snapshot
 * fixtures stay stable across runs.
 */
let _detCounters: Record<CorrelationIdPrefix, number> = {
  session: 0, project: 0, compile: 0, preflight: 0,
  frame: 0, job: 0, bundle: 0,
};

function isDeterministic(): boolean {
  if (typeof process !== 'undefined' && process.env?.LASERFORGE_DETERMINISTIC_IDS === '1') {
    return true;
  }
  if (typeof globalThis !== 'undefined') {
    return (globalThis as { __LF_DETERMINISTIC_IDS__?: boolean }).__LF_DETERMINISTIC_IDS__ === true;
  }
  return false;
}

export function resetCorrelationIdCounters(): void {
  _detCounters = {
    session: 0, project: 0, compile: 0, preflight: 0,
    frame: 0, job: 0, bundle: 0,
  };
}

export function generateCorrelationId(prefix: CorrelationIdPrefix): string {
  if (isDeterministic()) {
    _detCounters[prefix] += 1;
    return `${prefix}_det_${String(_detCounters[prefix]).padStart(6, '0')}`;
  }
  const ts = Date.now();
  const suffix = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `${prefix}_${ts}_${suffix}`;
}

/**
 * Builder for an empty correlation context: a fresh session ID and
 * everything else null. The session ID is generated eagerly on app
 * start, before any project/compile/job exists.
 */
export function emptyCorrelationIds(): CorrelationIds {
  return {
    sessionId: generateCorrelationId('session'),
    projectId: null,
    compileId: null,
    preflightId: null,
    frameId: null,
    jobId: null,
    supportBundleId: null,
  };
}

/**
 * Immutable update — returns a new object with one field changed.
 * Callers use this to advance the context as the user moves through
 * the app: load project, compile, preflight, frame, run job.
 */
export function withCorrelationId(
  ids: CorrelationIds,
  field: Exclude<keyof CorrelationIds, 'sessionId'>,
  value: string | null,
): CorrelationIds {
  return { ...ids, [field]: value };
}

/**
 * Snapshot for embedding in a log entry / error report / JobLog.
 * Just a structural copy today; defined as a helper so a future
 * subsystem can shrink the snapshot (e.g. omit `supportBundleId`)
 * without touching every call site.
 */
export function snapshotCorrelationIds(ids: CorrelationIds): CorrelationIds {
  return { ...ids };
}

/**
 * Recognises an ID emitted by `generateCorrelationId`. Used by the
 * support bundle pretty-printer to highlight which strings in a log
 * line are correlation IDs.
 */
export function isCorrelationId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  // matches '<prefix>_<ts>_<suffix>' or '<prefix>_det_<seq>'
  return /^(session|project|compile|preflight|frame|job|bundle)_(det_[0-9]{6}|[0-9]+_[a-z0-9]{6})$/.test(value);
}
