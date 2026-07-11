import { afterEach, describe, expect, it } from 'vitest';
import { createJobCheckpoint } from '../../core/recovery';
import { DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import {
  JOB_CHECKPOINT_STORAGE_KEY,
  clearJobCheckpoint,
  readJobCheckpoint,
  writeJobCheckpoint,
} from './job-checkpoint-storage';

const NOW = '2026-07-07T03:00:00.000Z';
// jobOrigin omitted = Absolute (byte-deterministic); these tests exercise
// storage round-tripping, not placement.
const SCOPE_PLACEMENT = { outputScope: DEFAULT_OUTPUT_SCOPE } as const;

afterEach(() => {
  localStorage.clear();
});

describe('job-checkpoint-storage', () => {
  it('round-trips a checkpoint through localStorage', () => {
    const cp = createJobCheckpoint({
      gcode: 'G21\nG90\nM5\n',
      machineKind: 'laser',
      ...SCOPE_PLACEMENT,
      nowIso: NOW,
    });
    writeJobCheckpoint(cp);
    expect(readJobCheckpoint()).toEqual(cp);
  });

  it('reads null from an empty slot', () => {
    expect(readJobCheckpoint()).toBeNull();
  });

  it('discards a corrupt slot on read', () => {
    localStorage.setItem(JOB_CHECKPOINT_STORAGE_KEY, '{not json');
    expect(readJobCheckpoint()).toBeNull();
    expect(localStorage.getItem(JOB_CHECKPOINT_STORAGE_KEY)).toBeNull();
  });

  it('clears the slot', () => {
    writeJobCheckpoint(
      createJobCheckpoint({
        gcode: 'G21\nM5\n',
        machineKind: 'cnc',
        ...SCOPE_PLACEMENT,
        nowIso: NOW,
      }),
    );
    clearJobCheckpoint();
    expect(readJobCheckpoint()).toBeNull();
  });
});
