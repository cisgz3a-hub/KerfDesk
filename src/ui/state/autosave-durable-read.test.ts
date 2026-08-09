import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createProject } from '../../core/scene';
import { readLatestDurableAutosave } from './autosave-durable-read';
import type { AutosaveDurableRepository } from './autosave-durable-repository';
import type { AutosaveIndexedDbRecord, AutosaveIndexedDbSlot } from './autosave-indexeddb';
import { autosaveStorageKeyForSession } from './autosave-local-storage';
import { prepareAutosaveRecord } from './autosave-record';
import { AutosaveSessionLocks } from './autosave-session-lock';

beforeEach(() => localStorage.clear());

describe('readLatestDurableAutosave corruption evidence', () => {
  it('keeps a valid current snapshot and discloses a corrupt previous snapshot', async () => {
    const read = await readLatestDurableAutosave(
      repositoryWithSlots([
        slot({ current: record('current project'), previousExpected: true, previous: null }),
      ]),
      new AutosaveSessionLocks(null),
      'current-session',
    );

    expect(read.snapshot?.project.notes).toBe('current project');
    expect(read.warnings).toEqual(['corrupt-slot']);
  });

  it('returns other valid sessions when one slot has no usable snapshot', async () => {
    const read = await readLatestDurableAutosave(
      repositoryWithSlots([
        slot({ storageKey: 'bad-key', currentExpected: true, current: null }),
        slot({ storageKey: 'good-key', current: record('valid recovery', 'good-key') }),
      ]),
      new AutosaveSessionLocks(null),
      'current-session',
    );

    expect(read.snapshot?.project.notes).toBe('valid recovery');
    expect(read.warnings).toEqual(['corrupt-slot']);
  });

  it('discloses a malformed local fallback instead of silently dropping it', async () => {
    localStorage.setItem('lf2:autosave:v1:corrupt-window', '{not project json');

    const read = await readLatestDurableAutosave(
      repositoryWithSlots([]),
      new AutosaveSessionLocks(null),
      'current-session',
    );

    expect(read.snapshot).toBeNull();
    expect(read.warnings).toContain('corrupt-slot');
  });

  it('rejects a local record whose embedded session disagrees with its storage key', async () => {
    const ownerKey = autosaveStorageKeyForSession('owner-window');
    const prepared = prepareAutosaveRecord(
      { ...createProject(), notes: 'live foreign recovery' },
      100,
      'reader-window',
      ownerKey,
    );
    if (prepared.kind !== 'ok') throw new Error('Expected a valid autosave fixture.');
    localStorage.setItem(ownerKey, JSON.stringify(prepared.record));
    const manager = {
      request: vi.fn(
        async (_name: string, _options: LockOptions, callback: (lock: Lock | null) => unknown) =>
          callback(null),
      ),
    } as unknown as LockManager;

    const read = await readLatestDurableAutosave(
      repositoryWithSlots([]),
      new AutosaveSessionLocks(manager),
      'reader-window',
    );

    expect(read.snapshot).toBeNull();
    expect(read.warnings).toContain('corrupt-slot');
  });
});

function slot(overrides: Partial<AutosaveIndexedDbSlot> = {}): AutosaveIndexedDbSlot {
  return {
    storageKey: 'slot-key',
    sessionId: 'other-session',
    epoch: 1,
    currentExpected: true,
    previousExpected: false,
    current: null,
    previous: null,
    ...overrides,
  };
}

function record(notes: string, storageKey = 'slot-key'): AutosaveIndexedDbRecord {
  const prepared = prepareAutosaveRecord(
    { ...createProject(), notes },
    100,
    'other-session',
    storageKey,
  );
  if (prepared.kind !== 'ok') throw new Error('Expected a valid autosave fixture.');
  return { ...prepared.record, sessionId: 'other-session', storageKey };
}

function repositoryWithSlots(slots: readonly AutosaveIndexedDbSlot[]): AutosaveDurableRepository {
  return {
    readAllSlots: async () => slots,
    readEpoch: async () => 0,
    commit: async () => {
      throw new Error('Unexpected commit.');
    },
    clear: async () => {
      throw new Error('Unexpected clear.');
    },
  };
}
