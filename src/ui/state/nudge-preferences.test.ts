import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_NUDGE_STEPS,
  MAX_NUDGE_MM,
  MIN_NUDGE_MM,
  NUDGE_STEPS_KEY,
  normalizeNudgeSteps,
  readNudgeSteps,
  useNudgeStore,
  writeNudgeSteps,
} from './nudge-preferences';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

afterEach(() => {
  useNudgeStore.getState().resetNudgeSteps();
  localStorage.removeItem(NUDGE_STEPS_KEY);
});

describe('nudge distance preferences', () => {
  it("keeps today's defaults: 1 mm, 10 mm with Shift, and the new 0.1 mm fine step", () => {
    expect(DEFAULT_NUDGE_STEPS).toEqual({ fineMm: 0.1, normalMm: 1, largeMm: 10 });
    expect(readNudgeSteps(memoryStorage())).toEqual(DEFAULT_NUDGE_STEPS);
    expect(readNudgeSteps(null)).toEqual(DEFAULT_NUDGE_STEPS);
  });

  it('clamps out-of-range values and replaces only the damaged field', () => {
    expect(normalizeNudgeSteps({ fineMm: 0, normalMm: 'x', largeMm: 1e9 })).toEqual({
      fineMm: MIN_NUDGE_MM,
      normalMm: DEFAULT_NUDGE_STEPS.normalMm,
      largeMm: MAX_NUDGE_MM,
    });
    expect(normalizeNudgeSteps([1, 2, 3])).toEqual(DEFAULT_NUDGE_STEPS);
    expect(normalizeNudgeSteps({ normalMm: Number.NaN, largeMm: 25 })).toEqual({
      ...DEFAULT_NUDGE_STEPS,
      largeMm: 25,
    });
  });

  it('reads back what it writes, and survives unreadable storage', () => {
    const storage = memoryStorage();
    writeNudgeSteps({ fineMm: 0.05, normalMm: 2, largeMm: 20 }, storage);
    expect(readNudgeSteps(storage)).toEqual({ fineMm: 0.05, normalMm: 2, largeMm: 20 });
    expect(readNudgeSteps(memoryStorage({ [NUDGE_STEPS_KEY]: '{not json' }))).toEqual(
      DEFAULT_NUDGE_STEPS,
    );
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readNudgeSteps(throwing)).toEqual(DEFAULT_NUDGE_STEPS);
    expect(() => writeNudgeSteps(DEFAULT_NUDGE_STEPS, throwing)).not.toThrow();
  });

  it('the store merges one distance at a time and persists it', () => {
    useNudgeStore.getState().setNudgeSteps({ largeMm: 5 });
    expect(useNudgeStore.getState().nudgeSteps).toEqual({ ...DEFAULT_NUDGE_STEPS, largeMm: 5 });
    expect(JSON.parse(localStorage.getItem(NUDGE_STEPS_KEY) ?? 'null')).toEqual({
      ...DEFAULT_NUDGE_STEPS,
      largeMm: 5,
    });
    useNudgeStore.getState().setNudgeSteps({ fineMm: -3 });
    expect(useNudgeStore.getState().nudgeSteps.fineMm).toBe(MIN_NUDGE_MM);
    useNudgeStore.getState().resetNudgeSteps();
    expect(useNudgeStore.getState().nudgeSteps).toEqual(DEFAULT_NUDGE_STEPS);
    expect(readNudgeSteps()).toEqual(DEFAULT_NUDGE_STEPS);
  });
});
