// What the camera does during a job (ADR-490), remembered per computer like
// the other camera choices: they belong to the camera on this machine, not
// to a project. Unreadable storage falls back to everything off.

export type JobWatchSettings = {
  readonly timelapse: boolean;
  readonly intervalSeconds: number;
  readonly burnCheck: boolean;
};

export const TIMELAPSE_INTERVALS_SECONDS: ReadonlyArray<number> = [2, 5, 10, 30];

export const DEFAULT_JOB_WATCH_SETTINGS: JobWatchSettings = {
  timelapse: false,
  intervalSeconds: 5,
  burnCheck: false,
};

const JOB_WATCH_STORAGE_KEY = 'kerfdesk.camera.job-watch.v1';

export function loadJobWatchSettings(): JobWatchSettings {
  try {
    const raw = localStorage.getItem(JOB_WATCH_STORAGE_KEY);
    return raw === null ? DEFAULT_JOB_WATCH_SETTINGS : normalizedSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_JOB_WATCH_SETTINGS;
  }
}

export function saveJobWatchSettings(settings: JobWatchSettings): void {
  try {
    localStorage.setItem(JOB_WATCH_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable: the choice lasts until the app closes.
  }
}

function normalizedSettings(value: unknown): JobWatchSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_JOB_WATCH_SETTINGS;
  const record = value as Record<string, unknown>;
  const interval = record['intervalSeconds'];
  return {
    timelapse: record['timelapse'] === true,
    intervalSeconds:
      typeof interval === 'number' && TIMELAPSE_INTERVALS_SECONDS.includes(interval)
        ? interval
        : DEFAULT_JOB_WATCH_SETTINGS.intervalSeconds,
    burnCheck: record['burnCheck'] === true,
  };
}
