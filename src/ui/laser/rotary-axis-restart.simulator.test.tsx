// ADR-695 Amendment 2 (rolling audit v14 Z2) against the GRBL simulator with
// the real store and Frame:
// - Z2-P2-1: a turn-back longer than 3 s finishes instead of giving up;
// - Z2-P1-1: after a controller restart the saved turn is never jogged to,
//   Start from line gets no turn, and Job Review says to turn it by hand;
// - Z2-P3-2: the first Frame of a Z rotary after a turn change completes.

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../core/devices';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { restoreOriginAfterAbort } from './abort-alarm-recovery';
import {
  abortRotaryZero,
  rotaryTurnSinceAbort,
  turnRotaryBackToJobStart,
} from './abort-rotary-turn';
import {
  drive,
  frameUntilPermit,
  harness,
  startFramedJob,
  installRecoveryStressHooks,
  tick,
  STRESS_TIMEOUT_MS,
} from './recovery-stress-testing';
import { rotaryAxisStartWarnings } from './rotary-axis-start-warnings';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

installRecoveryStressHooks();

const A_ROTARY: RotarySetup = {
  enabled: true,
  type: 'chuck',
  axis: 'A',
  axisConfirmed: 'A',
  mmPerRotation: 360,
  objectDiameterMm: 60,
};

function square(rotary: RotarySetup, controllerKind: 'grblhal' | 'grbl-v1.1'): Project {
  const project = createProject({ ...DEFAULT_DEVICE_PROFILE, controllerKind, rotary });
  const color = '#ff0000';
  const points = [
    { x: 4, y: 4 },
    { x: 24, y: 4 },
    { x: 24, y: 24 },
    { x: 4, y: 24 },
  ];
  return {
    ...project,
    scene: {
      ...EMPTY_SCENE,
      layers: [{ ...createLayer({ id: 'red', color }), power: 30, airAssist: false }],
      objects: [
        {
          kind: 'imported-svg',
          id: 'square',
          source: 'square.svg',
          bounds: { minX: 4, minY: 4, maxX: 24, maxY: 24 },
          transform: IDENTITY_TRANSFORM,
          paths: [{ color, polylines: [{ closed: true, points }] }],
        },
      ],
    },
  };
}

const GRBLHAL_A = {
  firmware: 'grblhal' as const,
  firmwareBanner: "GrblHAL 1.1f ['$' or '$HELP' for help]",
  fourthAxisA: true,
};

function epoch(): number {
  return useLaserStore.getState().machineZeroEpoch ?? 0;
}

describe('the rotary turn after an Abort', () => {
  it(
    'waits for a turn-back that takes longer than 3 s (Z2-P2-1)',
    async () => {
      const h = await harness({
        simulator: { ...GRBLHAL_A, motionMs: 6_000 },
        project: square(A_ROTARY, 'grblhal'),
      });
      await drive(useLaserStore.getState().jog({ da: 120, feed: 1500 }));
      await tick(7_000);
      expect(h.simulator.state().aAxis?.mpos).toBeCloseTo(120, 3);

      await drive(turnRotaryBackToJobStart({ axis: 'A', machine: 0, machineZeroEpoch: epoch() }));
      expect(h.simulator.state().aAxis?.mpos).toBeCloseTo(0, 3);
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'waits for a slow A axis held to its $113 rate (Z4-P3-1)',
    async () => {
      // 180° at $113=500 °/min takes 21.6 s; at the 1500 jog feed it would be 7.2 s.
      const h = await harness({
        simulator: { ...GRBLHAL_A, motionMs: 21_600, settings: [[113, '500']] },
        project: square(A_ROTARY, 'grblhal'),
      });
      expect(useLaserStore.getState().controllerSettings?.maxRateA).toBe(500);
      await drive(useLaserStore.getState().jog({ da: 180, feed: 1500 }), 30_000);
      await tick(23_000);
      expect(h.simulator.state().aAxis?.mpos).toBeCloseTo(180, 3);

      await drive(
        turnRotaryBackToJobStart({ axis: 'A', machine: 0, machineZeroEpoch: epoch() }),
        40_000,
      );
      expect(h.simulator.state().aAxis?.mpos).toBeCloseTo(0, 3);
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'never jogs to a turn saved before a controller restart (Z2-P1-1)',
    async () => {
      const h = await harness({ simulator: GRBLHAL_A, project: square(A_ROTARY, 'grblhal') });
      await drive(useLaserStore.getState().jog({ da: 40, feed: 1500 }));
      await tick(1_500);
      const turn = { axis: 'A' as const, machine: 0, machineZeroEpoch: epoch() };
      useLaserStore.setState({
        machineZeroEpoch: epoch() + 1,
        jobStopRequest: {
          reason: 'operator',
          streamerEpoch: useLaserStore.getState().streamerEpoch,
          rotaryStartTurn: turn,
        },
      });

      await expect(turnRotaryBackToJobStart(turn)).rejects.toThrow(/restarted/);
      await drive(restoreOriginAfterAbort({ x: 0, y: 0 }, false, turn));
      await tick(1_500);
      expect(h.simulator.state().aAxis?.mpos).toBeCloseTo(40, 3);
      // Start from line gets no turn, so it is refused rather than re-entered.
      expect(abortRotaryZero()).toBeUndefined();
      const since = rotaryTurnSinceAbort(useLaserStore.getState());
      expect(since).toEqual({ axis: 'A', since: null, restarted: true });
      const [warning] = rotaryAxisStartWarnings(square(A_ROTARY, 'grblhal'), {
        rotaryTurnSinceAbort: since,
      });
      expect(warning).toContain('by hand');
    },
    STRESS_TIMEOUT_MS,
  );
});

describe('a rotary on Z, stock GRBL simulator', () => {
  it(
    'completes its first Frame after the part was turned (Z2-P3-2)',
    async () => {
      const zRotary: RotarySetup = {
        ...A_ROTARY,
        axis: 'Z',
        axisConfirmed: 'Z',
        mmPerRotation: 40,
      };
      await harness({ project: square(zRotary, 'grbl-v1.1') });
      useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' } });
      await drive(useLaserStore.getState().jog({ dx: 20, dy: 30, feed: 3_000 }));
      await tick(1_500);
      await drive(useLaserStore.getState().setOriginHere());
      await tick(1_500);
      // Turn the part: work Z moves away from 0 before the Frame's G92 Z0.
      await drive(useLaserStore.getState().jog({ dz: 7, feed: 1500 }));
      await tick(1_500);

      await frameUntilPermit();
      expect(useLaserStore.getState().framedRun).not.toBeNull();
      expect(useLaserStore.getState().lastWriteError).toBeNull();
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'starts after one Frame when the part was turned (C2 verification E3-P3-3)',
    async () => {
      const zRotary: RotarySetup = {
        ...A_ROTARY,
        axis: 'Z',
        axisConfirmed: 'Z',
        mmPerRotation: 40,
      };
      const h = await harness({ project: square(zRotary, 'grbl-v1.1') });
      useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' } });
      // Turn the part first, so the Frame's own G92 Z0 moves the Z offset.
      await drive(useLaserStore.getState().jog({ dz: 7, feed: 1500 }));
      await tick(1_500);
      await drive(useLaserStore.getState().jog({ dx: 20, dy: 30, feed: 3_000 }));
      await tick(1_500);
      await drive(useLaserStore.getState().setOriginHere());
      await tick(1_500);

      // startFramedJob frames once and fails unless Start streams that permit.
      const { running } = await startFramedJob(h.repository);
      await drive(running);
      await tick(1_500);

      expect(h.simulator.state().g92?.z).toBeCloseTo(7, 3);
      expect(useLaserStore.getState().lastWriteError).toBeNull();
    },
    STRESS_TIMEOUT_MS,
  );
});
