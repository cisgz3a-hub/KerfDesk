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
import { automaticRestart } from '../../core/recovery/automatic-restart-line';
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
  holdHostDigests,
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
  const { gcode, capsule } = interrupted;
  const fromLine = automaticRestart(gcode, capsule.ackedLines, capsule.interruption).line;
  return oracleBurns(gcode).filter((burn) => burn.line >= fromLine);
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

type BeforeArchive = { readonly clearNotice: boolean };

/** Hold the Start's execution archive until after the rejection (ADR-337). */
function holdArchive(beforeArchive: BeforeArchive | undefined): () => void {
  return beforeArchive === undefined ? () => undefined : holdHostDigests();
}

/** Before activation the pending Start intent still owns the run, so the
 * terminal waits; the operator may press "I made the machine safe" meanwhile. */
function whileArchivePending(
  h: StressHarness,
  runId: string,
  beforeArchive: BeforeArchive | undefined,
): void {
  if (beforeArchive === undefined) return;
  expect(h.repository.getSnapshot().pendingStart?.runId).toBe(runId);
  expect(h.repository.getSnapshot().activeRun).toBeNull();
  expect(h.repository.getSnapshot().recoveryCapsule).toBeNull();
  if (beforeArchive.clearNotice) useLaserStore.getState().clearSafetyNotice();
}

/** The ack in the store update that first shows the stream errored: the one
 * the checkpoint tracker sees first. */
function watchAckWhenErrored(): {
  readonly ack: () => number | undefined;
  readonly stop: () => void;
} {
  let ack: number | undefined;
  const stop = useLaserStore.subscribe((state) => {
    if (ack === undefined && state.streamer?.status === 'errored') ack = state.streamer.completed;
  });
  return { ack: () => ack, stop };
}

describe('a line the controller rejects mid-job', () => {
  /** `beforeArchive` keeps the Start's execution archive pending through the
   * rejection, optionally with the safety notice acknowledged before it activates. */
  async function rejectedRun(beforeArchive?: BeforeArchive) {
    const rejectLines: { pattern: RegExp; errorCode: number }[] = [];
    const h = await harness({ simulator: { rejectLines } });
    const releaseDigests = holdArchive(beforeArchive);
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
    const errored = watchAckWhenErrored();
    for (let step = 0; step < 4_000; step += 1) {
      if (useLaserStore.getState().streamer?.status === 'errored') break;
      await tick(5);
    }
    errored.stop();
    expect(useLaserStore.getState().streamer?.status).toBe('errored');
    await tick(3_000);
    whileArchivePending(h, runId, beforeArchive);
    releaseDigests();
    await drive(running);
    const capsule = await expectCapsuleFor(h.repository, runId);
    if (capsule.artifact.kind !== 'exact-execution') throw new Error('Expected exact artifact.');
    return { h, capsule, gcode: capsule.artifact.gcode, target, ackedAtRejection: errored.ack() };
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
      const { h, capsule, gcode, target } = await rejectedRun();
      const rejectedLine = gcode.split('\n').findIndex((line) => line.trim() === target) + 1;
      const rejectedBurn = oracleBurns(gcode).find((burn) => burn.line === rejectedLine);
      if (rejectedBurn === undefined) throw new Error('Expected the rejected line to burn.');
      // GRBL answers a rejected line with error:N, which the stream counts as
      // acknowledged; the automatic restart must still start at that line.
      expect(rawResumeLine(gcode, capsule.ackedLines)).toBeGreaterThan(rejectedLine);
      expect(automaticRestart(gcode, capsule.ackedLines, capsule.interruption)).toEqual({
        line: rejectedLine,
        replaysRejectedLine: true,
      });
      // The operator unplugs and reconnects the controller, then recovers.
      h.simulator.yankCable();
      await tick(20);
      h.simulator = await connectSimulator();
      const before = h.simulator.outbound().length;
      vi.mocked(jobAwareAlert).mockClear();
      expect(await drive(runLaserRecoveryCapsuleFlow(capsule, h.repository))).toBe(true);
      expect(jobAwareAlert).not.toHaveBeenCalled();
      for (let waited = 0; waited < 60_000 && useLaserStore.getState().streamer !== null; ) {
        await tick(100);
        waited += 100;
      }
      expect(useLaserStore.getState().streamer).toBeNull();
      const sent = programLines(h.simulator, before);
      const burned = oracleBurns(sent.join('\n'), RECONNECTED_HEAD).map(burnGeometryKey);
      expect(burned).toContain(burnGeometryKey(rejectedBurn));
    },
    STRESS_TIMEOUT_MS,
  );

  it.each([
    { clearNotice: false, notice: 'still shown' },
    { clearNotice: true, notice: 'acknowledged' },
  ])(
    'a rejection before the Start archive activates still restarts at the rejected line (notice $notice)',
    async ({ clearNotice }) => {
      const { capsule, gcode, target, ackedAtRejection } = await rejectedRun({ clearNotice });
      // The deferred terminal records what the tracker first saw, not what the
      // store holds once the archive activates.
      expect(capsule.interruption).toMatchObject({
        kind: 'controller-error',
        rejectedLine: target,
      });
      expect(capsule.ackedLines).toBe(ackedAtRejection);
      const rejectedLine = gcode.split('\n').findIndex((line) => line.trim() === target) + 1;
      expect(automaticRestart(gcode, capsule.ackedLines, capsule.interruption)).toEqual({
        line: rejectedLine,
        replaysRejectedLine: true,
      });
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
      const { runId, running } = await startFramedJob(h.repository);
      await tick(80 + Math.floor(random() * 1_400));
      const acknowledged = useLaserStore.getState().streamer?.completed ?? -1;
      // Progress checkpoints exist only once the Start archive has activated
      // (ADR-337); the case below covers a tab that dies before that.
      expect(h.repository.getSnapshot().activeRun?.runId).toBe(runId);
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
    'app restart before the Start archive activates: the Start intent recovers from line 0 once its lease lapses',
    async () => {
      const h = await harness();
      const releaseDigests = holdHostDigests();
      const { runId, running } = await startFramedJob(h.repository);
      await tick(400);
      const acknowledged = useLaserStore.getState().streamer?.completed ?? -1;
      // The pending Start intent still owns the run, so no checkpoint was saved.
      expect(h.repository.getSnapshot().pendingStart?.runId).toBe(runId);
      expect(h.repository.getSnapshot().activeRun).toBeNull();
      expect(acknowledged).toBeGreaterThanOrEqual(CHECKPOINT_ACK_INTERVAL_LINES);
      h.stopTracking();
      const restarted = new RecoveryRepository({
        backend: h.backend,
        generationStore: h.generationStore,
        legacyStorage: { read: () => null, clear: () => undefined },
      });
      await drive(restarted.initialize());
      // Inside the owner lease the window that armed the Start may still be alive.
      expect(restarted.getSnapshot().recoveryCapsule).toBeNull();
      expect(restarted.getSnapshot().pendingStart?.runId).toBe(runId);
      await tick(5_000);
      // Line 0 re-burns what already ran rather than skipping anything.
      const capsule = restarted.getSnapshot().recoveryCapsule;
      expect(capsule?.runId).toBe(runId);
      expect(capsule?.interruption.kind).toBe('unknown');
      expect(capsule?.ackedLines).toBe(0);
      expect(capsule?.artifact.kind).toBe('legacy-fingerprint-only');
      expect(restarted.getSnapshot().pendingStart).toBeNull();
      // Only now may the dead tab's Start flow finish, so it cannot race the reconcile.
      releaseDigests();
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
