/**
 * Job execution log — persists GRBL messages, errors, settings, and timeline
 * for post-job review and "why did this fail?" debugging.
 */
import { getStorage } from '../storage/storage';

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

const JOB_LOGS_KEY = 'laserforge_job_logs';
const MAX_RETAINED_LOGS = 5;
const ONE_HOUR_MS = 60 * 60 * 1000;
let migrationAttempted = false;

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
export async function saveJobLog(log: JobLog): Promise<SaveJobLogResult> {
  await migrateJobLogsFromLocalStorage();
  try {
    const compactedLog = compactJobLogForStorage(log);
    const logs = await getJobLogs();
    logs.unshift(compactedLog);
    const trimmed = logs.slice(0, MAX_RETAINED_LOGS);

    const nowMs = Date.now();
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

    await getStorage().set(JOB_LOGS_KEY, JSON.stringify(agedTrimmed));
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
        await getStorage().set(JOB_LOGS_KEY, JSON.stringify([emergencyCompacted]));
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
export async function getJobLogs(): Promise<JobLog[]> {
  await migrateJobLogsFromLocalStorage();
  try {
    const raw = await getStorage().get(JOB_LOGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as JobLog[] : [];
  } catch {
    return [];
  }
}

/** Get a single log by ID */
export async function getJobLogById(id: string): Promise<JobLog | null> {
  const logs = await getJobLogs();
  return logs.find(l => l.id === id) ?? null;
}

/** Clear all logs */
export async function clearJobLogs(): Promise<void> {
  try {
    await getStorage().remove(JOB_LOGS_KEY);
  } catch {
    /* ignore */
  }
}

async function migrateJobLogsFromLocalStorage(): Promise<void> {
  if (migrationAttempted) return;
  migrationAttempted = true;
  if (typeof localStorage === 'undefined') return;

  try {
    const legacy = localStorage.getItem(JOB_LOGS_KEY);
    if (legacy === null) return;
    const storage = getStorage();
    const existing = await storage.get(JOB_LOGS_KEY);
    if (existing !== null) return;
    await storage.set(JOB_LOGS_KEY, legacy);
    localStorage.removeItem(JOB_LOGS_KEY);
  } catch {
    /* ignore */
  }
}

/** Test-only migration reset hook. */
export function resetJobLogsForTest(): void {
  migrationAttempted = false;
}
