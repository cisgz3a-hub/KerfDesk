/**
 * Job Replay — records everything that happens during a job for later review.
 * Stores settings, commands, responses, errors, timing, and operator actions.
 * Used for debugging failed jobs and feeding the self-learning material system.
 */
import { getStorage } from '../storage/storage';
import { generateId } from '../types';

export interface JobReplayEntry {
  timestamp: number;    // ms since job start
  type: 'tx' | 'rx' | 'event' | 'error' | 'operator';
  message: string;
}

export interface JobReplay {
  id: string;
  startedAt: string;         // ISO date
  completedAt: string | null;
  status: 'running' | 'completed' | 'failed' | 'failed_to_start' | 'stopped';

  // What was sent
  jobName: string;
  totalLines: number;
  linesCompleted: number;

  // Settings used
  settings: {
    layers: Array<{
      name: string;
      mode: string;
      power: number;
      speed: number;
      passes: number;
    }>;
    material: string | null;
    machineType: string | null;
  };

  // Timeline
  entries: JobReplayEntry[];
  errors: string[];
  warnings: string[];

  // Timing
  durationMs: number;
  estimatedMs: number | null;

  // Outcome (filled by user after job)
  outcome?: 'perfect' | 'too_dark' | 'too_light' | 'didnt_cut' | 'burned' | 'other';
  outcomeNotes?: string;
}

/**
 * Create a new replay recorder
 */
export function createReplay(
  jobName: string,
  totalLines: number,
  settings: JobReplay['settings'],
  estimatedMs: number | null,
): JobReplay {
  return {
    id: `replay_${generateId()}`,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: 'running',
    jobName,
    totalLines,
    linesCompleted: 0,
    settings,
    entries: [],
    errors: [],
    warnings: [],
    durationMs: 0,
    estimatedMs,
  };
}

/**
 * Add an entry to the replay timeline
 */
export function addReplayEntry(
  replay: JobReplay,
  type: JobReplayEntry['type'],
  message: string,
): void {
  const elapsed = Date.now() - new Date(replay.startedAt).getTime();
  replay.entries.push({ timestamp: elapsed, type, message });

  if (type === 'error') {
    replay.errors.push(message);
  }
}

/**
 * Finalize the replay when job ends
 */
export function finalizeReplay(
  replay: JobReplay,
  status: 'completed' | 'failed' | 'failed_to_start' | 'stopped',
  linesCompleted: number,
): void {
  replay.completedAt = new Date().toISOString();
  replay.status = status;
  replay.linesCompleted = linesCompleted;
  replay.durationMs = Date.now() - new Date(replay.startedAt).getTime();
}

/**
 * Save replay to storage adapter (fire-and-forget)
 */
export function saveReplay(replay: JobReplay): void {
  void _saveReplayForTest(replay);
}

/**
 * Load all saved replays
 */
export async function loadReplays(): Promise<JobReplay[]> {
  await migrateReplaysFromLocalStorage();
  return readAllReplays();
}

const REPLAY_KEY_PREFIX = 'laserforge_replay_';
const MAX_RETAINED_REPLAYS = 20;
const PRUNE_BATCH_SIZE = 5;
let migrationAttempted = false;

type ReplayRecord = { key: string; replay: JobReplay };

function replayStorageKey(id: string): string {
  return `${REPLAY_KEY_PREFIX}${id}`;
}

function safeParseReplay(raw: string): JobReplay | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as JobReplay;
  } catch {
    /* ignore invalid replay payload */
  }
  return null;
}

function compareByStartedAtDesc(a: JobReplay, b: JobReplay): number {
  return b.startedAt.localeCompare(a.startedAt);
}

async function loadReplayRecords(): Promise<ReplayRecord[]> {
  const records: ReplayRecord[] = [];
  try {
    const keys = await getStorage().list(REPLAY_KEY_PREFIX);
    for (const key of keys) {
      const raw = await getStorage().get(key);
      if (!raw) continue;
      const replay = safeParseReplay(raw);
      if (!replay) continue;
      records.push({ key, replay });
    }
  } catch {
    /* ignore */
  }
  return records;
}

async function readAllReplays(): Promise<JobReplay[]> {
  const records = await loadReplayRecords();
  return records
    .map(record => record.replay)
    .sort(compareByStartedAtDesc);
}

/**
 * Test hook: allows tests to await the internal write-through.
 */
export async function _saveReplayForTest(replay: JobReplay): Promise<void> {
  await migrateReplaysFromLocalStorage();
  try {
    await getStorage().set(replayStorageKey(replay.id), JSON.stringify(replay));

    const records = await loadReplayRecords();
    const sortedOldestFirst = records
      .map(record => record.replay)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

    if (sortedOldestFirst.length > MAX_RETAINED_REPLAYS) {
      const pruneCount = Math.min(PRUNE_BATCH_SIZE, sortedOldestFirst.length);
      for (let i = 0; i < pruneCount; i++) {
        const candidate = sortedOldestFirst[i];
        if (!candidate) continue;
        await getStorage().remove(replayStorageKey(candidate.id));
      }
    }
  } catch {
    console.warn('Failed to save job replay');
  }
}

async function migrateReplaysFromLocalStorage(): Promise<void> {
  if (migrationAttempted) return;
  migrationAttempted = true;
  if (typeof localStorage === 'undefined') return;

  try {
    const legacyKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(REPLAY_KEY_PREFIX)) legacyKeys.push(key);
    }
    for (const key of legacyKeys) {

      const existing = await getStorage().get(key);
      if (existing !== null) continue;

      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      await getStorage().set(key, raw);
      localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

/** Test-only migration reset hook. */
export function resetReplaysForTest(): void {
  migrationAttempted = false;
}
