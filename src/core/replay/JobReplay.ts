/**
 * Job Replay — records everything that happens during a job for later review.
 * Stores settings, commands, responses, errors, timing, and operator actions.
 * Used for debugging failed jobs and feeding the self-learning material system.
 */

export interface JobReplayEntry {
  timestamp: number;    // ms since job start
  type: 'tx' | 'rx' | 'event' | 'error' | 'operator';
  message: string;
}

export interface JobReplay {
  id: string;
  startedAt: string;         // ISO date
  completedAt: string | null;
  status: 'running' | 'completed' | 'failed' | 'stopped';

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
    id: `replay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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
  status: 'completed' | 'failed' | 'stopped',
  linesCompleted: number,
): void {
  replay.completedAt = new Date().toISOString();
  replay.status = status;
  replay.linesCompleted = linesCompleted;
  replay.durationMs = Date.now() - new Date(replay.startedAt).getTime();
}

/**
 * Save replay to localStorage
 */
export function saveReplay(replay: JobReplay): void {
  try {
    const key = `laserforge_replay_${replay.id}`;
    localStorage.setItem(key, JSON.stringify(replay));

    // Keep only last 20 replays
    const allKeys = Object.keys(localStorage)
      .filter(k => k.startsWith('laserforge_replay_'))
      .sort();
    while (allKeys.length > 20) {
      const oldest = allKeys.shift()!;
      localStorage.removeItem(oldest);
    }
  } catch {
    console.warn('Failed to save job replay');
  }
}

/**
 * Load all saved replays
 */
export function loadReplays(): JobReplay[] {
  const replays: JobReplay[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('laserforge_replay_')) {
        const data = localStorage.getItem(key);
        if (data) replays.push(JSON.parse(data));
      }
    }
  } catch { /* ignore */ }
  return replays.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
