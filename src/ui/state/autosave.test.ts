import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import {
  clearAutosave,
  readAutosave,
  startAutosaveLoop,
  writeAutosave,
} from './autosave';

const KEY = 'lf2:autosave:v1';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('writeAutosave / readAutosave round-trip', () => {
  it('roundtrips a project through localStorage', () => {
    const p = createProject();
    writeAutosave(p, 1_700_000_000_000);
    const r = readAutosave();
    expect(r).not.toBeNull();
    expect(r?.savedAt).toBe(1_700_000_000_000);
    expect(r?.project).toEqual(p);
  });

  it('returns null when no slot has been written', () => {
    expect(readAutosave()).toBeNull();
  });

  it('returns null on corrupt JSON in the slot', () => {
    localStorage.setItem(KEY, '{ not json');
    expect(readAutosave()).toBeNull();
  });

  it('returns null on schema version mismatch', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ schemaVersion: 999, savedAt: 0, projectJson: '{}' }),
    );
    expect(readAutosave()).toBeNull();
  });

  it('returns null when the embedded project JSON cannot deserialize', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ schemaVersion: 1, savedAt: 0, projectJson: '{"not":"a project"}' }),
    );
    expect(readAutosave()).toBeNull();
  });
});

describe('clearAutosave', () => {
  it('removes the slot', () => {
    writeAutosave(createProject());
    expect(readAutosave()).not.toBeNull();
    clearAutosave();
    expect(readAutosave()).toBeNull();
  });

  it('is a no-op when the slot is already empty', () => {
    expect(() => clearAutosave()).not.toThrow();
  });
});

describe('startAutosaveLoop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes when dirty and not streaming, on each interval tick', () => {
    const project = createProject();
    const stop = startAutosaveLoop(
      () => ({ project, dirty: true, isStreaming: false }),
      100,
    );
    expect(readAutosave()).toBeNull(); // no tick yet
    vi.advanceTimersByTime(100);
    expect(readAutosave()).not.toBeNull();
    stop();
  });

  it('skips writes when the project is not dirty', () => {
    const project = createProject();
    const stop = startAutosaveLoop(
      () => ({ project, dirty: false, isStreaming: false }),
      100,
    );
    vi.advanceTimersByTime(500);
    expect(readAutosave()).toBeNull();
    stop();
  });

  it('skips writes during streaming (do not perturb the render loop)', () => {
    const project = createProject();
    const stop = startAutosaveLoop(
      () => ({ project, dirty: true, isStreaming: true }),
      100,
    );
    vi.advanceTimersByTime(500);
    expect(readAutosave()).toBeNull();
    stop();
  });

  it('stop function cancels future writes', () => {
    let dirty = true;
    const project = createProject();
    const stop = startAutosaveLoop(
      () => ({ project, dirty, isStreaming: false }),
      100,
    );
    vi.advanceTimersByTime(100);
    expect(readAutosave()).not.toBeNull();
    clearAutosave();
    stop();
    // Even with dirty true, no more writes after stop.
    dirty = true;
    vi.advanceTimersByTime(1000);
    expect(readAutosave()).toBeNull();
  });
});
