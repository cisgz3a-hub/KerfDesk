// Shared harness for the recovery and completion-offer stress suites. Every
// piece is the production path: the real laser-store against the scripted GRBL
// simulator (planner back-pressure on, so acknowledgements track motion like
// real firmware), the real checkpoint tracker, the real recovery repository
// over an in-memory backend, the real recovery flow and the real completion
// prompt. Host SHA-256 runs on the simulated clock (`hashOnSimulatedClock`).
// Suites importing this module must mock '../state/job-aware-dialogs'.

import { createHash } from 'node:crypto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import {
  createGrblSimulator,
  type CreateGrblSimulatorOptions,
  type GrblSimulator,
} from '../../__fixtures__/controllers';
import { isSendableGcodeLine } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { rawResumeLine } from '../../core/recovery';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { installJobCheckpointTracking } from '../app/use-job-checkpoint';
import { useStore } from '../state';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import { useLaserSecondPassUiStore } from '../state/laser-second-pass-ui-store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository, type RecoveryCapsule } from '../state/recovery';
import { MemoryRecoveryStorageBackend } from '../state/recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from '../state/recovery/recovery-generation';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import { runLaserRecoveryCapsuleFlow } from './laser-recovery-flow';
import { buildLaserResumeProgram } from './laser-resume-program';
import { SecondPassCompletionPrompt } from './second-pass/SecondPassCompletionPrompt';
import { runStartJobFlow } from './start-job-flow';
import { runFrameNow } from './use-frame-action';

export const PROMPT_TEXT = 'Would you like to darken selected areas?';
export const STRESS_TIMEOUT_MS = 60_000;
// Planner back-pressure makes the simulator withhold `ok` while its 16-block
// planner is full, so acknowledgements arrive at motion pace (25 ms per
// segment) and a yank can land at any acknowledged line.
const SIM_OPTIONS = { plannerBlocks: 16, motionMs: 25 } as const;
const REALTIME_BYTES = new Set([
  '?',
  '!',
  '~',
  ...[0x18, 0x84, 0x85].map((code) => String.fromCharCode(code)),
]);

export interface StressHarness {
  readonly repository: RecoveryRepository;
  /** The in-memory store behind `repository`; a new repository over it models an app restart. */
  readonly backend: MemoryRecoveryStorageBackend;
  readonly generationStore: MemoryRecoveryGenerationStore;
  /** Stop checkpoint tracking without a terminal write, as a crashed tab would. */
  readonly stopTracking: () => void;
  /** Every run the tracker published as a clean completion, in order. */
  readonly offered: string[];
  readonly reportFailure: ReturnType<typeof vi.fn>;
  simulator: GrblSimulator;
  readonly promptShown: () => boolean;
  readonly dialogCount: () => number;
  readonly clickButton: (label: string) => Promise<void>;
}

let uninstallReview = (): void => undefined;
let uninstallTracking = (): void => undefined;
let host: HTMLDivElement;
let root: Root;
let heldDigests: Promise<void> | null = null;

/** Register the fake-timer, store, prompt-host and mock lifecycle for a suite. */
export function installRecoveryStressHooks(): void {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  beforeEach(() => {
    vi.useFakeTimers();
    heldDigests = null;
    hashOnSimulatedClock();
    resetStore();
    useJobReviewStore.getState().close();
    useLaserStore.setState(initialLaserState());
    useLaserSecondPassUiStore.setState({
      completionRunId: null,
      lastOfferedRunId: null,
      editorRequest: null,
    });
    useUiStore.setState({ modalDepth: 0 });
    vi.mocked(jobAwareAlert).mockClear();
    uninstallReview = installAutoJobReview('confirm');
    const consoleError = console.error.bind(console);
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) return;
      consoleError(...args);
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    uninstallTracking();
    uninstallTracking = (): void => undefined;
    uninstallReview();
    useJobReviewStore.getState().close();
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    await useLaserStore.getState().disconnect();
    useLaserStore.setState(initialLaserState());
    resetStore();
    vi.restoreAllMocks();
  });
}

/** WebCrypto resolves `crypto.subtle.digest` on a real event-loop turn, and
 * advancing fake time grants the real loop one turn per fired timer. A Start's
 * archive hashes in three sequential rounds before it activates, so on a
 * loaded runner the simulated machine would stream on while it hashed, and a
 * seeded restart could land before activation and find only the pending Start
 * (ADR-337). The same SHA-256 bytes, resolved on the microtask queue, finish
 * before the next simulated acknowledgement, as hashing a job this size does
 * on real hardware. */
function hashOnSimulatedClock(): void {
  const subtle = globalThis.crypto.subtle;
  const webCryptoDigest = subtle.digest.bind(subtle);
  vi.spyOn(subtle, 'digest').mockImplementation(async (algorithm, data) => {
    if (!isSha256(algorithm)) return webCryptoDigest(algorithm, data);
    if (heldDigests !== null) await heldDigests;
    return sha256(data);
  });
}

/** Hold every host SHA-256 until the returned release runs, so an accepted
 * Start's execution archive cannot activate (ADR-337's pre-activation window).
 * A hold its test never releases stays pending: those flows stop for good
 * rather than resume into the next test, whose beforeEach starts unheld. */
export function holdHostDigests(): () => void {
  let release = (): void => undefined;
  heldDigests = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    heldDigests = null;
    release();
  };
}

function isSha256(algorithm: AlgorithmIdentifier): boolean {
  const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
  return name.toUpperCase() === 'SHA-256';
}

function sha256(data: BufferSource): ArrayBuffer {
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
  return new Uint8Array(createHash('sha256').update(bytes).digest()).buffer;
}

/** Twenty separate strokes so the program has dozens of acknowledgeable lines. */
function stripedProject() {
  const project = createProject(DEFAULT_DEVICE_PROFILE);
  // eslint-disable-next-line no-restricted-syntax -- Test artwork color, not application chrome.
  const color = '#ff0000';
  const objects = Array.from({ length: 20 }, (_, index) => ({
    kind: 'imported-svg' as const,
    id: `stripe-${index}`,
    source: `stripe-${index}.svg`,
    bounds: { minX: 4, minY: 4 + index * 2, maxX: 30, maxY: 4 + index * 2 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
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
  }));
  return {
    ...project,
    scene: {
      ...EMPTY_SCENE,
      layers: [{ ...createLayer({ id: 'red', color }), power: 30, airAssist: false }],
      objects,
    },
  };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Advance fake time in small steps until a flow promise settles. */
export async function drive<T>(promise: Promise<T>, maxMs = 20_000): Promise<T> {
  let settled = false;
  let failed = false;
  let value!: T;
  let error: unknown;
  void promise.then(
    (result) => {
      settled = true;
      value = result;
    },
    (reason: unknown) => {
      settled = true;
      failed = true;
      error = reason;
    },
  );
  for (let elapsed = 0; !settled && elapsed < maxMs; elapsed += 20) await tick(20);
  if (!settled) throw new Error(`Flow did not settle within ${maxMs} ms of simulated time.`);
  if (failed) throw error;
  return value;
}

export async function connectSimulator(
  overrides: CreateGrblSimulatorOptions = {},
): Promise<GrblSimulator> {
  const simulator = createGrblSimulator({ ...SIM_OPTIONS, ...overrides });
  await act(async () => {
    await useLaserStore.getState().connect(simulator.adapter);
  });
  await tick(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  expect(useLaserStore.getState().controllerOperation).toBeNull();
  return simulator;
}

export async function harness(
  options: {
    readonly simulator?: CreateGrblSimulatorOptions;
    readonly project?: Project;
  } = {},
): Promise<StressHarness> {
  const simulator = await connectSimulator(options.simulator);
  const backend = new MemoryRecoveryStorageBackend();
  const generationStore = new MemoryRecoveryGenerationStore();
  const repository = new RecoveryRepository({
    backend,
    generationStore,
    legacyStorage: { read: () => null, clear: () => undefined },
  });
  await repository.initialize();
  useStore.setState({ project: options.project ?? stripedProject() });
  const offered: string[] = [];
  const reportFailure = vi.fn();
  uninstallTracking = installJobCheckpointTracking(
    () => new Date().toISOString(),
    repository,
    reportFailure,
    (runId) => {
      offered.push(runId);
      useLaserSecondPassUiStore.getState().offerCompletion(runId);
    },
  );
  await act(async () => {
    root.render(<SecondPassCompletionPrompt repository={repository} />);
  });
  return {
    repository,
    backend,
    generationStore,
    stopTracking: () => {
      uninstallTracking();
      uninstallTracking = (): void => undefined;
    },
    offered,
    reportFailure,
    simulator,
    promptShown: () => host.textContent?.includes(PROMPT_TEXT) === true,
    dialogCount: () => host.querySelectorAll('[role="dialog"]').length,
    clickButton: async (label) => {
      const button = Array.from(host.querySelectorAll('button')).find(
        (node) => node.textContent === label,
      );
      if (button === undefined) throw new Error(`Missing button: ${label}`);
      await act(async () => button.click());
    },
  };
}

/** Frame the job on the simulator exactly as the Frame button does, wait for the
 * permit its final Idle mints, then press Start through Job Review. Returns once
 * the stream has been accepted by the controller. */
export async function startFramedJob(
  repository: RecoveryRepository,
): Promise<{ readonly runId: string; readonly running: Promise<void> }> {
  expect(await drive(runFrameNow(), 60_000)).toBe(true);
  for (let step = 0; step < 2_000 && useLaserStore.getState().framedRun === null; step += 1) {
    await tick(5);
  }
  if (useLaserStore.getState().framedRun === null) throw new Error('Frame issued no permit.');
  const running = runStartJobFlow(repository);
  for (let step = 0; step < 600 && useLaserStore.getState().streamer === null; step += 1) {
    await tick(5);
  }
  const runId = useLaserStore.getState().activeRunId;
  if (runId === null) throw new Error('The framed job was not accepted by the simulator.');
  return { runId, running };
}

/** Program lines written to the simulator since `from`, realtime bytes removed. */
export function programLines(simulator: GrblSimulator, from: number): string[] {
  return simulator
    .outbound()
    .slice(from)
    .flatMap((write) =>
      [...write]
        .filter((character) => !REALTIME_BYTES.has(character))
        .join('')
        .split('\n'),
    )
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export async function expectCapsuleFor(
  repository: RecoveryRepository,
  runId: string,
): Promise<RecoveryCapsule> {
  await vi.waitFor(() => expect(repository.getSnapshot().recoveryCapsule?.runId).toBe(runId));
  const capsule = repository.getSnapshot().recoveryCapsule;
  if (capsule === null) throw new Error('Expected the interrupted capsule.');
  return capsule;
}

/** Reconnect a fresh simulator, resume the capsule through the real recovery
 * flow, let it finish, and prove exactly the resume program reached the wire
 * before the completion offer for the recovery run appears. */
export async function recoverAndComplete(h: StressHarness, runId: string): Promise<string> {
  const capsule = await expectCapsuleFor(h.repository, runId);
  if (capsule.artifact.kind !== 'exact-execution') throw new Error('Expected exact artifact.');
  const gcode = capsule.artifact.gcode;
  const resumeLine = rawResumeLine(gcode, capsule.ackedLines);
  const expected = buildLaserResumeProgram(gcode, resumeLine);
  if (expected.kind !== 'ok') throw new Error(expected.reason);
  const expectedSent = expected.lines.filter(isSendableGcodeLine);
  // The resume point sits exactly after the acknowledged sendable lines.
  const sendableTotal = gcode.split('\n').filter(isSendableGcodeLine).length;
  if (capsule.ackedLines < sendableTotal) {
    expect(
      gcode
        .split('\n')
        .slice(0, resumeLine - 1)
        .filter(isSendableGcodeLine),
    ).toHaveLength(capsule.ackedLines);
  }

  h.simulator = await connectSimulator();
  const outboundBefore = h.simulator.outbound().length;
  const started = await drive(runLaserRecoveryCapsuleFlow(capsule, h.repository));
  expect(jobAwareAlert).not.toHaveBeenCalled();
  expect(started).toBe(true);
  const recoveryRunId = useLaserStore.getState().activeRunId;
  if (recoveryRunId === null || recoveryRunId === runId)
    throw new Error('Expected a distinct recovery run identity.');
  expect(h.repository.getSnapshot().recoveryCapsule).toBeNull();
  expect(h.repository.getSnapshot().activeRun?.runId).toBe(recoveryRunId);

  await tick(8_000);
  expect(useLaserStore.getState().streamer).toBeNull();
  expect(useLaserStore.getState().controllerOperation).toBeNull();
  const sent = programLines(h.simulator, outboundBefore);
  expect(sent.slice(0, expectedSent.length)).toEqual(expectedSent);
  expect(sent.slice(expectedSent.length)).toEqual(['G4 P0.01']);
  await vi.waitFor(() =>
    expect(h.repository.getSnapshot().lastCompletedReceipt?.runId).toBe(recoveryRunId),
  );
  await tick(50);
  expect(h.offered.at(-1)).toBe(recoveryRunId);
  expect(useLaserSecondPassUiStore.getState().completionRunId).toBe(recoveryRunId);
  expect(h.promptShown()).toBe(true);
  return recoveryRunId;
}
