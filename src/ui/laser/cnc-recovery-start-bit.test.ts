// Rolling audit v4 H3-P1-1 (ADR-215 Amendment 2): CNC recovery checks Work Z
// against the bit its own program starts with, and refuses another bit's zero.
// A 1/8" → 1/4" job resumed in operation 2 streams only the 1/4" passes, with
// no M0 before them; recovery used to check the job's FIRST bit instead.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../core/scene';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import type { RecoveryRepository } from '../state/recovery';
import { runCncPassRecoveryFlow } from './cnc-pass-recovery-flow';
import { repository, saveInterruptedRun } from './cnc-pass-recovery-flow-test-fixtures';
import { configureReadyCncRecovery } from './cnc-recovery-flow-testing';
import { runStartFromLineFlow } from './start-job-flow';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const EIGHTH = 'em-3175';
const QUARTER = 'em-6350';

function verticalLine(id: string, color: string, x: number): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: 20, maxX: x, maxY: 80 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            points: [
              { x, y: 20 },
              { x, y: 50 },
              { x, y: 80 },
            ],
            closed: false,
          },
        ],
      },
    ],
  } as SceneObject;
}

// Scene-data colours for the two operations, not UI chrome.
const GREEN = '#00aa00';
const PURPLE = '#aa00aa';

function twoBitProject() {
  return {
    ...createProject({
      ...DEFAULT_DEVICE_PROFILE,
      streamingMode: 'ping-pong' as const,
      rxBufferBytes: 96,
    }),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      ...EMPTY_SCENE,
      objects: [verticalLine('a', GREEN, 20), verticalLine('b', PURPLE, 60)],
      layers: [
        {
          ...createLayer({ id: 'eighth', color: GREEN }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, toolId: EIGHTH, depthMm: 2, depthPerPassMm: 1 },
        },
        {
          ...createLayer({ id: 'quarter', color: PURPLE }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, toolId: QUARTER, depthMm: 2, depthPerPassMm: 1 },
        },
      ],
    },
  };
}

function zeroedFor(toolId: string): void {
  useLaserStore.setState({
    workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 7, toolId },
  });
}

const originalStartJob = useLaserStore.getState().startJob;
beforeEach(() => {
  localStorage.clear();
  resetStore();
  configureReadyCncRecovery(twoBitProject() as never);
  useLaserStore.setState({ detectedControllerKind: 'grbl-v1.1' });
  vi.mocked(jobAwareAlert).mockClear();
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
});
afterEach(() => {
  localStorage.clear();
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.restoreAllMocks();
});

// The job ran (and was interrupted) on the first bit's zero.
async function interruptedTwoBitRun() {
  zeroedFor(EIGHTH);
  const repo = repository();
  const capsule = await saveInterruptedRun(repo);
  return { repo, capsule };
}

async function resume(
  repo: RecoveryRepository,
  capsule: Awaited<ReturnType<typeof saveInterruptedRun>>,
  groupIndex: number,
) {
  const startJob = vi.fn(async (_gcode: string, _options?: unknown) => undefined);
  useLaserStore.setState({ startJob });
  vi.mocked(jobAwareConfirm).mockClear();
  vi.mocked(jobAwareAlert).mockClear();
  const started = await runCncPassRecoveryFlow(
    capsule,
    {
      cutterClear: true,
      spindleStopped: true,
      workholdingConfirmed: true,
      toolConfirmed: true,
      position: { kind: 're-zeroed' },
      groupIndex,
      passIndex: 0,
    },
    repo,
  );
  const options = startJob.mock.calls[0]?.[1] as
    | { readonly cncToolPlan?: ReadonlyArray<{ readonly id: string | null }> }
    | undefined;
  return {
    started,
    streamed: startJob.mock.calls.length,
    streamedBits: options?.cncToolPlan?.map((tool) => tool.id) ?? null,
    alerts: vi.mocked(jobAwareAlert).mock.calls.map((call) => String(call[0])),
    confirms: vi.mocked(jobAwareConfirm).mock.calls.map((call) => String(call[0])),
  };
}

describe('pass recovery checks Work Z against its own first bit', () => {
  it('streams operation 2 on the 1/4" zero, with no advisory naming the 1/8" bit', async () => {
    const { repo, capsule } = await interruptedTwoBitRun();
    zeroedFor(QUARTER);
    const result = await resume(repo, capsule, 1);
    expect(result.started).toBe(true);
    expect(result.streamedBits).toEqual([QUARTER]);
    expect(result.confirms.join('\n')).not.toMatch(/starts with 3\.175/);
    expect(result.alerts).toEqual([]);
  });

  it('refuses operation 2 on the 1/8" zero and names both bits, sending nothing', async () => {
    const { repo, capsule } = await interruptedTwoBitRun();
    const result = await resume(repo, capsule, 1);
    expect(result.started).toBe(false);
    expect(result.streamed).toBe(0);
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]).toMatch(/^Cannot start CNC recovery:/);
    expect(result.alerts[0]).toContain('The recovery program starts with 6.35 mm');
    expect(result.alerts[0]).toContain('work Z was established for 3.175 mm');
    // Refused before the claim, so the saved job stays retryable.
    expect(repo.getSnapshot().recoveryCapsule?.claim).toBeUndefined();
  });

  it('streams the same recovery once the 1/4" bit is zeroed', async () => {
    const { repo, capsule } = await interruptedTwoBitRun();
    expect((await resume(repo, capsule, 1)).started).toBe(false);
    zeroedFor(QUARTER);
    const retried = await resume(repo, capsule, 1);
    expect(retried.started).toBe(true);
    expect(retried.streamedBits).toEqual([QUARTER]);
  });

  it('checks a resume in operation 1 against the 1/8" bit, which still holds before its M0', async () => {
    const { repo, capsule } = await interruptedTwoBitRun();
    const onFirst = await resume(repo, capsule, 0);
    expect(onFirst.started).toBe(true);
    expect(onFirst.streamedBits).toEqual([EIGHTH, QUARTER]);

    const second = await interruptedTwoBitRun();
    zeroedFor(QUARTER);
    const wrong = await resume(second.repo, second.capsule, 0);
    expect(wrong.started).toBe(false);
    expect(wrong.alerts[0]).toContain('The recovery program starts with 3.175 mm');
  });
});

describe('Start from line on a CNC job', () => {
  it('refuses a two-bit CNC project without sending anything', async () => {
    zeroedFor(QUARTER);
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });
    await runStartFromLineFlow(5);
    expect(startJob).not.toHaveBeenCalled();
    expect(vi.mocked(jobAwareAlert).mock.calls[0]?.[0]).toMatch(/^Cannot resume CNC job:/);
  });
});
