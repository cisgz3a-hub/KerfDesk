// Controller audit recovery-3, end to end (ADR-364). A Smoothieware or Marlin
// job runs on the simulator; its interrupted run is then resumed through the
// real recovery flow and the real laser store on a reconnected simulator whose
// board kept a lit beam. The resumed run must burn what the original burned
// from the resume line on. Both simulators take their beam state from the
// upstream-ported power models in src/__fixtures__/controllers.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMarlinSimulator,
  createSmoothieSimulator,
  type FakeSerialPort,
} from '../../__fixtures__/controllers';
import {
  powerUpMarlin,
  runMarlinLines,
  type MarlinBurn,
} from '../../__fixtures__/controllers/marlin-laser-power-model';
import {
  powerUpSmoothie,
  runSmoothieLines,
  type SmoothieBurn,
} from '../../__fixtures__/controllers/smoothie-laser-power-model';
import { mixedLaserProject } from '../../core/controllers/grbl/laser-resume-project.test-helper';
import {
  profileCatalogEntryById,
  type ControllerKind,
  type DeviceProfile,
} from '../../core/devices';
import { DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { startTestLaserJob } from '../state/laser-test-start-helpers';
import { RecoveryRepository } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { resetStore } from '../state/test-helpers';
import { runLaserRecoveryCapsuleFlow } from './laser-recovery-flow';
import { prepareStartJob } from './start-job-readiness';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

type Burn = SmoothieBurn | MarlinBurn;

type Simulator = {
  readonly adapter: PlatformAdapter;
  readonly port: FakeSerialPort;
  readonly state: () => {
    readonly burns: ReadonlyArray<Burn>;
    readonly modelErrors: ReadonlyArray<string>;
  };
};

type Dialect = {
  readonly name: string;
  readonly controllerKind: ControllerKind;
  readonly device: () => DeviceProfile;
  readonly simulator: (litBeam: boolean) => Simulator;
  /** Every burn of a program on a controller that just powered up. */
  readonly burns: (gcode: string) => ReadonlyArray<Burn>;
};

function profile(id: string): DeviceProfile {
  const entry = profileCatalogEntryById(id)?.profile;
  if (entry === undefined) throw new Error(`${id} profile fixture missing`);
  return { ...entry, airAssistCommand: 'M8' };
}

const DIALECTS: ReadonlyArray<Dialect> = [
  {
    name: 'Smoothieware',
    controllerKind: 'smoothieware',
    device: () => profile('generic-smoothieware'),
    // A Frame's tool-off lines zeroed the scale; the operator then test-fired.
    simulator: (litBeam) =>
      createSmoothieSimulator(
        litBeam ? { initialPowerLines: ['M221 S0 P1'], initialManualFire: true } : {},
      ),
    burns: (gcode) => runSmoothieLines(powerUpSmoothie(), gcode).burns,
  },
  {
    name: 'Marlin inline',
    controllerKind: 'marlin',
    device: () => profile('generic-marlin-laser'),
    simulator: (litBeam) =>
      createMarlinSimulator(
        litBeam ? { initialPowerLines: ['M3 I S200', 'G1 X1 Y1 F9000 S200'] } : {},
      ),
    burns: (gcode) => runMarlinLines(powerUpMarlin(), gcode).burns,
  },
  {
    name: 'Marlin fan',
    controllerKind: 'marlin',
    device: () => ({
      ...profile('generic-marlin-laser'),
      gcodeDialect: { dialectId: 'marlin-fan' },
    }),
    simulator: (litBeam) =>
      createMarlinSimulator(litBeam ? { initialPowerLines: ['M106 S255', 'G1 F9000'] } : {}),
    burns: (gcode) => runMarlinLines(powerUpMarlin(), gcode).burns,
  },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  resetStore();
  useLaserStore.setState(initialLaserState());
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function pump(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function settle<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  void promise.finally(() => {
    settled = true;
  });
  for (let elapsed = 0; !settled && elapsed < 30_000; elapsed += 20) await pump(20);
  return promise;
}

async function drainStream(): Promise<void> {
  for (let step = 0; step < 600 && useLaserStore.getState().streamer !== null; step += 1) {
    await pump(50);
  }
  expect(useLaserStore.getState().streamer).toBeNull();
}

async function connect(dialect: Dialect, litBeam: boolean): Promise<Simulator> {
  const simulator = dialect.simulator(litBeam);
  await useLaserStore
    .getState()
    .connect(simulator.adapter, { controllerKind: dialect.controllerKind });
  await pump(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return simulator;
}

function prepared(project: ReturnType<typeof mixedLaserProject>) {
  const laser = useLaserStore.getState();
  const result = prepareStartJob(
    project,
    laser.controllerSettings,
    { statusReport: laser.statusReport, alarmCode: null, hasActiveStreamer: false },
    { startFrom: 'absolute', anchor: 'front-left' },
    DEFAULT_OUTPUT_SCOPE,
    undefined,
    false,
  );
  if (!result.ok) throw new Error(result.messages.join('\n'));
  return result;
}

function burnKey(burn: Burn): string {
  const mode = 'mode' in burn ? burn.mode : burn.source;
  return JSON.stringify([burn.from, burn.to, burn.power, mode, burn.feed, burn.air]);
}

describe.each(DIALECTS)('interrupted $name job', (dialect) => {
  it('resumed on a reconnected simulator burns what the original burned from the resume line', async () => {
    const project = mixedLaserProject(dialect.device());
    useStore.setState({ project });
    const first = await connect(dialect, false);
    const job = prepared(project);
    const original = dialect.burns(job.gcode);

    // The original job, streamed whole, burns what its text says.
    await startTestLaserJob(job.gcode, { streamingMode: 'ping-pong' });
    await drainStream();
    expect(first.state().modelErrors).toEqual([]);
    expect(first.state().burns.map(burnKey)).toEqual(original.map(burnKey));

    // Its run record, interrupted by a pulled cable.
    const repository = new RecoveryRepository({
      backend: new MemoryRecoveryStorageBackend(),
      generationStore: new MemoryRecoveryGenerationStore(),
      legacyStorage: { read: () => null, clear: () => undefined },
    });
    const laser = useLaserStore.getState();
    const artifact = await createCurrentTestExecutionArtifact({
      runId: `interrupted-${dialect.name}`,
      gcode: job.gcode,
      prepared: job.prepared,
      canvasPlan: job.canvasPlan,
      controllerSettings: laser.controllerSettings,
      controllerObservation: {
        statusReport: laser.statusReport,
        wco: laser.wcoCache,
        activeControllerKind: laser.activeControllerKind,
        detectedControllerKind: laser.detectedControllerKind,
        controllerSessionEpoch: laser.controllerSessionEpoch,
      },
    });
    expect((await repository.stageArtifact(artifact)).ok).toBe(true);
    await repository.activateFreshRun(artifact.runId);
    await repository.interruptRun(artifact.runId, 40, {
      kind: 'disconnect',
      message: 'Cable pulled.',
    });
    const capsule = repository.getSnapshot().recoveryCapsule;
    if (capsule === null) throw new Error('Expected a recovery capsule.');

    // A board that did not reset: its beam is still lit.
    await useLaserStore.getState().disconnect();
    const second = await connect(dialect, true);
    // Mid-way through the constant-power line, whose power is modal there.
    const fromLine = original[Math.floor(original.length / 2)]?.line ?? 0;
    const started = await settle(runLaserRecoveryCapsuleFlow(capsule, repository, { fromLine }));
    expect(vi.mocked(jobAwareAlert).mock.calls).toEqual([]);
    expect(started).toBe(true);
    await drainStream();

    expect(second.state().modelErrors).toEqual([]);
    const expected = original.filter((burn) => burn.line >= fromLine).map(burnKey);
    expect(expected.length).toBeGreaterThan(10);
    expect(second.state().burns.map(burnKey)).toEqual(expected);
  }, 60_000);
});
