import { describe, expect, it } from 'vitest';
import { estimateExecutionArtifactBytes } from './execution-artifact';
import { appendBoundedExecutionHistory } from './execution-history';
import { emptyRecoverySlots, type ExecutionHistoryRecord } from './recovery-model';

function record(runId: string, estimatedArtifactBytes: number): ExecutionHistoryRecord {
  return {
    runId,
    terminalKind: 'completed',
    startedAtIso: '2026-07-19T03:00:00.000Z',
    terminalAtIso: '2026-07-19T03:01:00.000Z',
    ackedLines: 1,
    sendableLines: 1,
    estimatedArtifactBytes,
  };
}

describe('bounded execution history', () => {
  it('counts embedded project payload and binary buffers in the artifact estimate', () => {
    const embeddedProject = 'A'.repeat(256 * 1024);
    const estimated = estimateExecutionArtifactBytes({
      gcode: 'M5\n',
      prepared: {
        project: { scene: { objects: [{ source: embeddedProject }] } },
        job: { groups: [{ sValues: new Uint16Array(64 * 1024) }] },
      },
    });
    expect(estimated).toBeGreaterThan(embeddedProject.length + 128 * 1024);
  });

  it('uses the full artifact estimate for the byte cap and keeps the newest record', () => {
    const slots = emptyRecoverySlots(0);
    const first = record('run-a', 700_000);
    const second = record('run-b', 700_000);
    const withFirst = {
      ...slots,
      executionHistory: appendBoundedExecutionHistory(slots, first, {
        maxRuns: 20,
        maxEstimatedBytes: 1_000_000,
      }),
    };
    expect(
      appendBoundedExecutionHistory(withFirst, second, {
        maxRuns: 20,
        maxEstimatedBytes: 1_000_000,
      }),
    ).toEqual([second]);
  });

  it('never prunes a recovery-owned terminal record even over the cap', () => {
    const first = record('run-recovery', 2_000_000);
    const slots = {
      ...emptyRecoverySlots(0),
      recoveryCapsule: {
        runId: first.runId,
        artifactKind: 'exact-execution' as const,
        revision: 1,
        ackedLines: 1,
        sendableLines: 2,
        interruption: { kind: 'disconnect' as const, message: 'Cable removed.' },
        updatedAtIso: first.terminalAtIso,
      },
      executionHistory: [first],
    };
    const second = record('run-new', 2_000_000);
    expect(
      appendBoundedExecutionHistory(slots, second, {
        maxRuns: 1,
        maxEstimatedBytes: 1,
      }).map((item) => item.runId),
    ).toEqual(['run-recovery', 'run-new']);
  });
});
