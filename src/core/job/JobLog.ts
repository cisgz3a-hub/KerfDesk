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

  // Summary
  linesCompleted: number;
  errors: number;
  warnings: number;
  actualDuration: number;     // ms
}

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

/** Save log to localStorage */
export function saveJobLog(log: JobLog): void {
  try {
    const logs = getJobLogs();
    logs.unshift(log);
    // Keep last 20 logs
    const trimmed = logs.slice(0, 20);
    localStorage.setItem('laserforge_job_logs', JSON.stringify(trimmed));
  } catch {
    // Storage full — silently skip
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
