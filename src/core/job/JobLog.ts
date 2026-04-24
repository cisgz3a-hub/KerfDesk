/**
 * Job execution log — persists GRBL messages, errors, settings, and timeline
 * for post-job review and "why did this fail?" debugging.
 */

export interface JobLogEntry {
  timestamp: number;    // Date.now()
  type: 'info' | 'sent' | 'received' | 'error' | 'warning' | 'milestone';
  message: string;
}

export interface JobLog {
  id: string;
  startedAt: string;          // ISO 8601
  completedAt: string | null;
  status: 'running' | 'completed' | 'failed' | 'stopped';

  // Job context
  projectName: string;
  gcodeLines: number;
  estimatedTime: string;

  // Settings used
  layers: Array<{
    name: string;
    mode: string;
    power: number;
    speed: number;
    passes: number;
  }>;

  // Machine state at start
  machineStatus: string;
  startPosition: { x: number; y: number };

  // Timeline
  entries: JobLogEntry[];

  /** Internal: entry list was truncated to cap memory */
  _truncated?: boolean;

  // Summary
  linesCompleted: number;
  errors: number;
  warnings: number;
  actualDuration: number;     // ms
}

export interface SaveJobLogResult {
  ok: boolean;
  error?: 'quota' | 'serialize' | 'other';
  message?: string;
}

/** Compact large entry lists for storage (cap raw tx/rx, keep all milestones and warnings). */
function compactJobLogForStorage(log: JobLog): JobLog {
  const compacted: JobLog = { ...log, entries: [...log.entries] };
  if (compacted.entries.length > 200) {
    const nonRaw = compacted.entries.filter(
      e => e.type === 'milestone' || e.type === 'error' || e.type === 'warning',
    );
    const rawEntries = log.entries.filter(e => e.type === 'sent' || e.type === 'received');
    const keptRaw = [...rawEntries.slice(0, 25), ...rawEntries.slice(-25)];
    compacted.entries = [...nonRaw, ...keptRaw].sort((a, b) => a.timestamp - b.timestamp);
  }
  return compacted;
}

export { compactJobLogForStorage };

/** Create a new empty job log */
export function createJobLog(
  projectName: string,
  gcodeLines: number,
  estimatedTime: string,
  layers: JobLog['layers'],
  machineStatus: string,
  startPosition: { x: number; y: number },
): JobLog {
  return {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: 'running',
    projectName,
    gcodeLines,
    estimatedTime,
    layers,
    machineStatus,
    startPosition,
    entries: [],
    linesCompleted: 0,
    errors: 0,
    warnings: 0,
    actualDuration: 0,
  };
}

/** Add an entry to the log */
export function addLogEntry(
  log: JobLog,
  type: JobLogEntry['type'],
  message: string,
): void {
  // Cap entries to prevent memory bloat on long engrave jobs
  if (log.entries.length >= 1000) {
    if (!log._truncated) {
      log.entries = [
        ...log.entries.slice(0, 10),
        { timestamp: Date.now(), type: 'info', message: `--- ${log.entries.length - 10} earlier entries truncated ---` },
      ];
      log._truncated = true;
    }
    if (log.entries.length >= 1100) {
      log.entries = [
        ...log.entries.slice(0, 11),
        ...log.entries.slice(-989),
      ];
    }
  }

  log.entries.push({
    timestamp: Date.now(),
    type,
    message,
  });
  if (type === 'error') log.errors++;
  if (type === 'warning') log.warnings++;
}

/** Finalize the log */
export function finalizeLog(
  log: JobLog,
  status: 'completed' | 'failed' | 'stopped',
  linesCompleted: number,
): void {
  log.completedAt = new Date().toISOString();
  log.status = status;
  log.linesCompleted = linesCompleted;
  log.actualDuration = Date.now() - new Date(log.startedAt).getTime();
}

function isStorageQuotaError(err: unknown): boolean {
  return (
    err instanceof Error
    && (err.name === 'QuotaExceededError'
      || (err as { name?: string }).name === 'NS_ERROR_DOM_QUOTA_REACHED'
      || /quota/i.test(err.message))
  );
}

/** Save log to localStorage */
export function saveJobLog(log: JobLog): SaveJobLogResult {
  try {
    const compactedLog = compactJobLogForStorage(log);
    const logs = getJobLogs();
    logs.unshift(compactedLog);
    const trimmed = logs.slice(0, 5);

    const nowMs = Date.now();
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const agedTrimmed = trimmed.map((l, idx) => {
      if (idx === 0) return l;
      const logStartMs = new Date(l.startedAt).getTime();
      if (Number.isNaN(logStartMs) || nowMs - logStartMs < ONE_HOUR_MS) return l;
      return {
        ...l,
        entries: l.entries.filter(
          e => e.type === 'milestone' || e.type === 'error' || e.type === 'warning',
        ),
      };
    });

    localStorage.setItem('laserforge_job_logs', JSON.stringify(agedTrimmed));
    return { ok: true };
  } catch (err) {
    if (isStorageQuotaError(err)) {
      try {
        const emergencyCompacted = {
          ...log,
          entries: log.entries.filter(
            e => e.type === 'milestone' || e.type === 'error',
          ),
        };
        localStorage.setItem(
          'laserforge_job_logs',
          JSON.stringify([emergencyCompacted]),
        );
        return {
          ok: true,
          error: 'quota',
          message:
            'Browser storage full. Saved only the current job; previous logs were purged.',
        };
      } catch {
        return {
          ok: false,
          error: 'quota',
          message: 'Browser storage full. Job log could not be saved. Clear old logs or free storage.',
        };
      }
    }

    return {
      ok: false,
      error: err instanceof Error ? 'serialize' : 'other',
      message: err instanceof Error ? err.message : 'Unknown error saving job log',
    };
  }
}

/** Get all saved logs */
export function getJobLogs(): JobLog[] {
  try {
    const raw = localStorage.getItem('laserforge_job_logs');
    if (!raw) return [];
    return JSON.parse(raw) as JobLog[];
  } catch {
    return [];
  }
}

/** Get a single log by ID */
export function getJobLogById(id: string): JobLog | null {
  return getJobLogs().find(l => l.id === id) ?? null;
}

/** Clear all logs */
export function clearJobLogs(): void {
  localStorage.removeItem('laserforge_job_logs');
}
