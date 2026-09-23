// Deep audit of interrupted-job recovery (ADR-341) through the production
// path: real laser store, checkpoint tracker, recovery repository and recovery
// flow against the GRBL simulator with planner back-pressure. What the resumed
// program actually burns is read back from the simulator's wire bytes with an
// independent interpreter, never compared with the resume builder's own output.

import { describe, expect, it, vi } from 'vitest';
import { isSendableGcodeLine } from '../../core/controllers/grbl';
import {
  burnGeometryKey,
  oracleBurns,
  type OracleBurn,
} from '../../core/controllers/grbl/laser-burn-oracle.test-helper';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { rawResumeLine } from '../../core/recovery';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import { CHECKPOINT_ACK_INTERVAL_LINES } from '../state/job-checkpoint-storage';
import { useLaserStore } from '../state/laser-store';
import { RecoveryRepository, type RecoveryCapsule } from '../state/recovery';
import { runLaserRecoveryCapsuleFlow } from './laser-recovery-flow';
import {
  connectSimulator,
  drive,
  expectCapsuleFor,
  harness,
  installRecoveryStressHooks,
  mulberry32,
  programLines,
  startFramedJob,
  STRESS_TIMEOUT_MS,
  tick,
  type StressHarness,
} from './recovery-stress-testing';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

installRecoveryStressHooks();

const ART = '#ff0000';
const RECONNECTED_HEAD = { x: 777.7, y: 666.6 };

/** A small grayscale photo: every row is one G1 followed by modal continuation lines. */
function photoProject(): Project {
  const base = createProject(DEFAULT_DEVICE_PROFILE);
  const width = 24;
  const height = 6;
  const luma = Array.from({ length: width * height }, (_, index) => (index * 37 + 11) % 256);
  return {
    ...base,
    scene: {
      ...EMPTY_SCENE,
      objects: [
        {
          kind: 'raster-image',
          id: 'photo',
          color: ART,
          source: 'photo.png',
          dataUrl: 'data:image/png;base64,archived-preview-is-not-the-machining-source',
          lumaBase64: Buffer.from(luma).toString('base64'),
          pixelWidth: width,
          pixelHeight: height,
          bounds: { minX: 10, minY: 10, maxX: 34, maxY: 16 },
          transform: IDENTITY_TRANSFORM,
          dither: 'grayscale',
          linesPerMm: 1,
        },
      ],
      layers: [
        {
          ...createLayer({ id: 'image', color: ART, mode: 'image' }),
          ditherAlgorithm: 'grayscale',
          linesPerMm: 1,
          imageBidirectional: true,
          power: 60,
          speed: 1200,
          airAssist: false,
        },
      ],
    },
  };
}

/** Thirty vector strokes cut with air assist on (M8). */
function airCutProject(): Project {
  const base = createProject({ ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'M8' });
  return {
    ...base,
    scene: {
      ...EMPTY_SCENE,
      objects: Array.from({ length: 30 }, (_, index) => ({
        kind: 'imported-svg' as const,
        id: `cut-${index}`,
        source: `cut-${index}.svg`,
        bounds: { minX: 4, minY: 4 + index * 2, maxX: 30, maxY: 4 + index * 2 },
        transform: IDENTITY_TRANSFORM,
        paths: [
          {
            color: ART,
            polylines: [
              {
                closed: false,
                points: [
                  { x: 4, y: 4 + index * 2 },
                  { x: 30, y: 4 + index * 2 },
                ],
              },
            ],
          },
        ],
      })),
      layers: [{ ...createLayer({ id: 'cut', color: ART }), power: 80, airAssist: true }],
    },
  };
}

type Interrupted = {
  readonly h: StressHarness;
  readonly runId: string;
  readonly capsule: RecoveryCapsule;
  readonly gcode: string;
};

async function yankAt(h: StressHarness, delayMs: number): Promise<Interrupted> {
  const { runId, running } = await startFramedJob(h.repository);
  await tick(delayMs);
  if (useLaserStore.getState().streamer === null) throw new Error('The job finished first.');
  h.simulator.yankCable();
  await tick(20);
  await drive(running);
  const capsule = await expectCapsuleFor(h.repository, runId);
  if (capsule.artifact.kind !== 'exact-execution') throw new Error('Expected exact artifact.');
  return { h, runId, capsule, gcode: capsule.artifact.gcode };
}

/** Recover through the real flow on a fresh controller; return the lines sent. */
async function recoverOnWire(interrupted: Interrupted): Promise<string[]> {
  const { h, capsule } = interrupted;
  h.simulator = await connectSimulator();
  const before = h.simulator.outbound().length;
  expect(await drive(runLaserRecoveryCapsuleFlow(capsule, h.repository))).toBe(true);
  expect(jobAwareAlert).not.toHaveBeenCalled();
  await tick(8_000);
  expect(useLaserStore.getState().streamer).toBeNull();
  return programLines(h.simulator, before);
}

/** What the original program burns from the automatic restart line onward. */
function originalRemainder(interrupted: Interrupted): OracleBurn[] {
  const fromLine = rawResumeLine(interrupted.gcode, interrupted.capsule.ackedLines);
  return oracleBurns(interrupted.gcode).filter((burn) => burn.line >= fromLine);
}

describe('what a recovered job actually burns (wire bytes, independent interpreter)', () => {
  it.each([1, 2, 3, 4, 5, 6])(
    'photo interrupted at seed %i: the recovered remainder burns every original raster segment',
    async (seed) => {
      const random = mulberry32(seed * 104729);
      const interrupted = await yankAt(
        await harness({ project: photoProject() }),
        150 + Math.floor(random() * 900),
      );
      const expected = originalRemainder(interrupted).map(burnGeometryKey);
      expect(expected.length).toBeGreaterThan(0);
      const sent = await recoverOnWire(interrupted);
      const burned = oracleBurns(sent.join('\n'), RECONNECTED_HEAD).map(burnGeometryKey);
      const missing = expected.filter((key) => !burned.includes(key));
      expect(missing).toEqual([]);
      expect(burned).toEqual(expected);
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'air-assisted cut interrupted mid-layer: every recovered burn runs with air assist on',
    async () => {
      const interrupted = await yankAt(await harness({ project: airCutProject() }), 250);
      const original = originalRemainder(interrupted);
      expect(original.length).toBeGreaterThan(0);
      expect(new Set(original.map((burn) => burn.air))).toEqual(new Set(['M8']));
      const sent = await recoverOnWire(interrupted);
      const recovered = oracleBurns(sent.join('\n'), RECONNECTED_HEAD);
      expect(recovered.map(burnGeometryKey)).toEqual(original.map(burnGeometryKey));
      expect(recovered.map((burn) => burn.air)).toEqual(original.map((burn) => burn.air));
    },
    STRESS_TIMEOUT_MS,
  );
});

describe('a line the controller rejects mid-job', () => {
  async function rejectedRun() {
    const rejectLines: { pattern: RegExp; errorCode: number }[] = [];
    const h = await harness({ simulator: { rejectLines } });
    const { runId, running } = await startFramedJob(h.repository);
    const queued = (useLaserStore.getState().streamer?.queued ?? []).map((line) => line.trim());
    const target = queued.filter((line) => /^G1\b.*S[1-9]/.test(line))[11];
    if (target === undefined) throw new Error('Expected a twelfth burn line.');
    expect(queued.filter((line) => line === target)).toHaveLength(1);
    // error:1 is what a byte corrupted in transit produces; resending the line succeeds.
    rejectLines.push({
      pattern: new RegExp(`^${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
      errorCode: 1,
    });
    for (let step = 0; step < 4_000; step += 1) {
      if (useLaserStore.getState().streamer?.status === 'errored') break;
      await tick(5);
    }
    expect(useLaserStore.getState().streamer?.status).toBe('errored');
    await tick(3_000);
    await drive(running);
    const capsule = await expectCapsuleFor(h.repository, runId);
    if (capsule.artifact.kind !== 'exact-execution') throw new Error('Expected exact artifact.');
    return { h, capsule, gcode: capsule.artifact.gcode, target };
  }

  it(
    'records the rejection, the rejected line and the controller-error cause',
    async () => {
      const { capsule, target } = await rejectedRun();
      expect(capsule.interruption).toMatchObject({
        kind: 'controller-error',
        rejectedLine: target,
      });
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'the default recovery replays the burn the controller rejected',
    async () => {
      const { capsule, gcode, target } = await rejectedRun();
      const rejectedLine = gcode.split('\n').findIndex((line) => line.trim() === target) + 1;
      const rejectedBurn = oracleBurns(gcode).find((burn) => burn.line === rejectedLine);
      if (rejectedBurn === undefined) throw new Error('Expected the rejected line to burn.');
      // Automatic recovery restarts after the acknowledged count. GRBL answers a
      // rejected line with error:N, which the stream counts as acknowledged.
      const automatic = rawResumeLine(gcode, capsule.ackedLines);
      expect(automatic).toBeLessThanOrEqual(rejectedLine);
    },
    STRESS_TIMEOUT_MS,
  );
});

describe('evidence bounds the recovery point can rely on', () => {
  it.each([11, 22, 33, 44, 55, 66, 77, 88])(
    'app restart at seed %i: the saved line trails the acknowledged line by less than one checkpoint interval',
    async (seed) => {
      const random = mulberry32(seed);
      const h = await harness();
      const { running } = await startFramedJob(h.repository);
      await tick(80 + Math.floor(random() * 1_400));
      const acknowledged = useLaserStore.getState().streamer?.completed ?? -1;
      h.stopTracking(); // the tab dies: no terminal record is written
      const restarted = new RecoveryRepository({
        backend: h.backend,
        generationStore: h.generationStore,
        legacyStorage: { read: () => null, clear: () => undefined },
      });
      await drive(restarted.initialize());
      const capsule = restarted.getSnapshot().recoveryCapsule;
      expect(capsule?.interruption.kind).toBe('unknown');
      expect(capsule?.ackedLines).toBeLessThanOrEqual(acknowledged);
      expect(acknowledged - (capsule?.ackedLines ?? 0)).toBeLessThan(CHECKPOINT_ACK_INTERVAL_LINES);
      await drive(running);
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'acknowledged lines stay within one planner of executed motion and one RX window of sent lines',
    async () => {
      const random = mulberry32(2718);
      let widestPlanner = 0;
      let widestInFlight = 0;
      for (let sample = 0; sample < 6; sample += 1) {
        const h = await harness({ project: photoProject() });
        const { running } = await startFramedJob(h.repository);
        await tick(100 + Math.floor(random() * 1_000));
        const streamer = useLaserStore.getState().streamer;
        if (streamer === null) throw new Error('The job finished first.');
        const planner = h.simulator.planner();
        widestPlanner = Math.max(widestPlanner, planner.blocks);
        widestInFlight = Math.max(widestInFlight, streamer.inFlight.length);
        expect(planner.blocks).toBeLessThanOrEqual(planner.capacity);
        expect(streamer.inFlightBytes).toBeLessThanOrEqual(streamer.rxBufferBytes);
        expect(streamer.inFlight.every((entry) => isSendableGcodeLine(entry.line))).toBe(true);
        h.simulator.yankCable();
        await tick(20);
        await drive(running);
      }
      // The recovery point is acknowledged, not executed: up to a full planner of
      // acknowledged blocks may be unexecuted when the controller resets, and every
      // sent-but-unacknowledged line may still execute when it keeps running.
      expect(widestPlanner).toBeGreaterThan(0);
      expect(widestInFlight).toBeGreaterThan(0);
    },
    STRESS_TIMEOUT_MS,
  );
});
