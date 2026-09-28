// A laser run too large for the exact archive still leaves a record when it is
// interrupted (ADR-341 Amendment 8).

import { describe, expect, it } from 'vitest';
import { DEFAULT_OUTPUT_SCOPE } from '../../../core/scene';
import { MemoryRecoveryStorageBackend } from './recovery-backend';
import { MemoryRecoveryGenerationStore } from './recovery-generation';
import { RecoveryRepository } from './recovery-repository';
import { createStartIntent } from './start-intent';
import type { UntrackedRunRecord } from './untracked-run-record';

const NOW = '2026-09-27T16:00:00.000Z';
const GCODE = [
  'G21',
  'G90',
  'G0 X0 Y0',
  'M4 S0',
  'G1 X10 S500 F3000',
  'G1 X20',
  'G1 X30',
  'M5',
].join('\n');

function repositoryOn(backend = new MemoryRecoveryStorageBackend()): RecoveryRepository {
  return new RecoveryRepository({
    backend,
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => NOW,
  });
}

function record(runId: string, extra: Partial<UntrackedRunRecord> = {}): UntrackedRunRecord {
  return {
    runId,
    intent: createStartIntent({
      gcode: GCODE,
      machineKind: 'laser',
      outputScope: DEFAULT_OUTPUT_SCOPE,
      nowIso: NOW,
    }),
    startWorkOffsetMm: { x: 120.5, y: 80.25, z: 0 },
    ...extra,
  };
}

const LOST_LINK = { kind: 'disconnect', message: 'Connection lost.', sentLines: 6 } as const;

describe('record of a run too large to archive', () => {
  it('turns an interruption into a fingerprint-only capsule with the origin at Start', async () => {
    const backend = new MemoryRecoveryStorageBackend();
    const repository = repositoryOn(backend);
    await repository.initialize();
    await repository.noteUntrackedRunAccepted('run-big', record('run-big'));

    const interrupted = await repository.interruptRun('run-big', 5, LOST_LINK, NOW);

    expect(interrupted).toEqual({ ok: true, value: true });
    const capsule = repository.getSnapshot().recoveryCapsule;
    expect(capsule?.runId).toBe('run-big');
    expect(capsule?.ackedLines).toBe(5);
    expect(capsule?.sendableLines).toBe(8);
    expect(capsule?.interruption).toEqual(LOST_LINK);
    expect(capsule?.artifact).toMatchObject({
      kind: 'legacy-fingerprint-only',
      startWorkOffsetMm: { x: 120.5, y: 80.25, z: 0 },
    });

    const reopened = repositoryOn(backend);
    await reopened.initialize();
    expect(reopened.getSnapshot().recoveryCapsule?.artifact).toMatchObject({
      startWorkOffsetMm: { x: 120.5, y: 80.25, z: 0 },
    });
  });

  it('keeps an interruption that arrives before Start hands the run over', async () => {
    const repository = repositoryOn();
    await repository.initialize();

    expect(await repository.interruptRun('run-early', 3, LOST_LINK, NOW)).toEqual({
      ok: true,
      value: false,
    });
    await repository.noteUntrackedRunAccepted('run-early', record('run-early'));

    expect(repository.getSnapshot().recoveryCapsule?.runId).toBe('run-early');
    expect(repository.getSnapshot().recoveryCapsule?.ackedLines).toBe(3);
  });

  it('leaves nothing after a clean finish or for a run it was not told about', async () => {
    const repository = repositoryOn();
    await repository.initialize();
    await repository.noteUntrackedRunAccepted('run-done', record('run-done'));

    expect(await repository.completeRun('run-done', NOW)).toEqual({ ok: true, value: false });
    expect(await repository.interruptRun('run-other', 2, LOST_LINK, NOW)).toEqual({
      ok: true,
      value: false,
    });
    expect(repository.getSnapshot().recoveryCapsule).toBeNull();
  });

  it("counts a recovery run's progress in the job's own lines", async () => {
    const repository = repositoryOn();
    await repository.initialize();
    const progress = { jobLinesBefore: 4, preambleLines: 7 };
    await repository.noteUntrackedRunAccepted('run-resume', record('run-resume', { progress }));

    const backlog = { ackedAtStatus: 8, queuedBlocks: 1 };
    await repository.interruptRun(
      'run-resume',
      9,
      { ...LOST_LINK, sentLines: 10, plannerBacklog: backlog },
      NOW,
    );

    const capsule = repository.getSnapshot().recoveryCapsule;
    expect(capsule?.ackedLines).toBe(6);
    expect(capsule?.interruption.sentLines).toBe(7);
    expect(capsule?.interruption.plannerBacklog).toEqual({ ackedAtStatus: 5, queuedBlocks: 1 });
  });
});
