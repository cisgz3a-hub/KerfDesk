// Arrow-key nudge distances (Rayforge comparison; LightBurn's "nudge" and
// "big nudge" preferences). An app preference kept in this browser, like the
// snap settings: never in the project file, so a shared project never changes
// how far your arrow keys move artwork.
//
//   Ctrl/Cmd+arrow  fine    0.1 mm
//   arrow           normal  1 mm
//   Shift+arrow     large   10 mm

import { create } from 'zustand';
import { browserLocalStorage } from './browser-local-storage';

export type NudgeSteps = {
  readonly fineMm: number;
  readonly normalMm: number;
  readonly largeMm: number;
};

export type NudgeStepKey = keyof NudgeSteps;

export const DEFAULT_NUDGE_STEPS: NudgeSteps = { fineMm: 0.1, normalMm: 1, largeMm: 10 };
export const MIN_NUDGE_MM = 0.01;
export const MAX_NUDGE_MM = 1000;
export const NUDGE_STEPS_KEY = 'kerfdesk.nudge-steps.v1';

const STEP_KEYS: ReadonlyArray<NudgeStepKey> = ['fineMm', 'normalMm', 'largeMm'];

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

// Each distance falls back on its own, so one damaged value never resets the
// others; out-of-range numbers are clamped, never refused.
export function normalizeNudgeSteps(
  value: unknown,
  fallback: NudgeSteps = DEFAULT_NUDGE_STEPS,
): NudgeSteps {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : {};
  const pick = (key: NudgeStepKey): number => {
    const raw = record[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback[key];
    return Math.min(MAX_NUDGE_MM, Math.max(MIN_NUDGE_MM, raw));
  };
  return { fineMm: pick('fineMm'), normalMm: pick('normalMm'), largeMm: pick('largeMm') };
}

export function readNudgeSteps(
  storage: PreferenceStorage | null = browserLocalStorage(),
): NudgeSteps {
  try {
    const stored = storage?.getItem(NUDGE_STEPS_KEY);
    if (stored === null || stored === undefined) return DEFAULT_NUDGE_STEPS;
    return normalizeNudgeSteps(JSON.parse(stored));
  } catch {
    return DEFAULT_NUDGE_STEPS;
  }
}

export function writeNudgeSteps(
  steps: NudgeSteps,
  storage: PreferenceStorage | null = browserLocalStorage(),
): void {
  try {
    storage?.setItem(NUDGE_STEPS_KEY, JSON.stringify(steps));
  } catch {
    // Storage is optional; the in-memory preference still applies this session.
  }
}

type NudgeState = {
  readonly nudgeSteps: NudgeSteps;
  // Merges, clamps and persists.
  readonly setNudgeSteps: (next: Partial<NudgeSteps>) => void;
  readonly resetNudgeSteps: () => void;
};

export const useNudgeStore = create<NudgeState>((set) => ({
  nudgeSteps: readNudgeSteps(),
  setNudgeSteps: (next) =>
    set((state) => {
      const merged = normalizeNudgeSteps({ ...state.nudgeSteps, ...next }, state.nudgeSteps);
      if (STEP_KEYS.every((key) => merged[key] === state.nudgeSteps[key])) return state;
      writeNudgeSteps(merged);
      return { nudgeSteps: merged };
    }),
  resetNudgeSteps: () => {
    writeNudgeSteps(DEFAULT_NUDGE_STEPS);
    set({ nudgeSteps: DEFAULT_NUDGE_STEPS });
  },
}));
