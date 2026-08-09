import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { autosaveSlotGeneration, clearAutosave, readAutosave, writeAutosave } from './autosave';
import { currentAutosaveSessionId } from './autosave-local-storage';
import { readLocalAutosaveSnapshots } from './autosave-local-storage';

const KEY = 'lf2:autosave:v1';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it('reports quota failure instead of silently claiming autosave worked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('storage full', 'QuotaExceededError');
    });

    const result = writeAutosave(createProject());

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'failed',
        reason: 'quota',
      }),
    );
    expect(readAutosave()).toBeNull();
  });

  it('keeps independent window sessions from overwriting each other', () => {
    const first = { ...createProject(), notes: 'first window' };
    const second = { ...createProject(), notes: 'second window' };

    expect(writeAutosave(first, 100, { sessionId: 'window-a' }).kind).toBe('ok');
    expect(writeAutosave(second, 200, { sessionId: 'window-b' }).kind).toBe('ok');
    expect(readAutosave()?.project.notes).toBe('second window');

    clearAutosave({ sessionId: 'window-b' });

    expect(readAutosave()?.project.notes).toBe('first window');
  });

  it('discovers per-session records even when the shared fallback index loses an entry', () => {
    expect(
      writeAutosave({ ...createProject(), notes: 'window a' }, 100, { sessionId: 'window-a' }).kind,
    ).toBe('ok');
    expect(
      writeAutosave({ ...createProject(), notes: 'window b' }, 200, { sessionId: 'window-b' }).kind,
    ).toBe('ok');
    localStorage.setItem(
      'lf2:autosave:index:v1',
      JSON.stringify({ schemaVersion: 1, keys: ['lf2:autosave:v1:window-a'] }),
    );

    expect(readLocalAutosaveSnapshots().map((snapshot) => snapshot.project.notes)).toEqual(
      expect.arrayContaining(['window a', 'window b']),
    );
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

  it('invalidates the interval memo even when local storage is unavailable', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const before = autosaveSlotGeneration();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('storage blocked', 'SecurityError');
      },
    });
    try {
      expect(clearAutosave()).toEqual({ kind: 'unavailable', keys: [] });
      expect(autosaveSlotGeneration()).not.toBe(before);
    } finally {
      if (descriptor !== undefined) Object.defineProperty(globalThis, 'localStorage', descriptor);
    }
  });
});

describe('autosave session identity fallback', () => {
  it('survives a throwing sessionStorage getter', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('session storage blocked', 'SecurityError');
      },
    });
    try {
      expect(currentAutosaveSessionId()).toMatch(/\S/);
    } finally {
      if (descriptor !== undefined) Object.defineProperty(globalThis, 'sessionStorage', descriptor);
    }
  });
});

// autosaveSlotGeneration is how a background writer that memoized what it put
// in the slot learns the slot no longer holds it. Only clearing changes it —
// re-writing does not, because the writer already knows about its own write.
describe('autosaveSlotGeneration', () => {
  it('changes on every clear and holds steady across writes', () => {
    const beforeClear = autosaveSlotGeneration();
    writeAutosave(createProject());
    expect(autosaveSlotGeneration()).toBe(beforeClear);

    clearAutosave();

    const afterClear = autosaveSlotGeneration();
    expect(afterClear).not.toBe(beforeClear);
    clearAutosave();
    expect(autosaveSlotGeneration()).not.toBe(afterClear);
  });
});

// The startAutosaveLoop suite moved to the co-located ./autosave-loop.test.ts
// when the interval moved to ./autosave-loop.ts.

describe('writeAutosave called synchronously (beforeunload path)', () => {
  // The hook test path lives in use-autosave; here we just verify
  // writeAutosave is itself synchronous — the beforeunload handler
  // can call it inline without awaiting, which is the whole point
  // (browsers/Electron may not honor async work during unload).
  it('completes before the next statement (no Promise)', () => {
    const project = createProject();
    const before = readAutosave();
    writeAutosave(project);
    const after = readAutosave();
    expect(before).toBeNull();
    expect(after).not.toBeNull();
  });
});
