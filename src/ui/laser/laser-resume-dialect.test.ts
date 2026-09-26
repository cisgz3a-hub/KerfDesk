// Controller audit recovery-3 (ADR-364): a resumed Smoothieware or Marlin laser
// program re-arms the beam in the power commands its own strategy writes.
// Resume transforms 1 and 2 wrote GRBL's `M5` / `M3 S0` for every program and
// zeroed these dialects' power words, so the resumed job ran dark and a new
// resume on them was refused. Both resume paths now build transform 3, and a
// saved step still replays the exact bytes its own transform built.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { grblDriver, selectControllerDriver } from '../../core/controllers';
import { buildResumeProgram, type StatusReport } from '../../core/controllers/grbl';
import type { ControllerKind, DeviceProfile } from '../../core/devices';
import { fingerprintGcode } from '../../core/recovery';
import {
  createLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository, type ExecutionArtifactV1 } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { runLaserRecoveryCapsuleFlow } from './laser-recovery-flow';
import { buildLaserResumeProgram } from './laser-resume-program';
import { recoveryArtifactPreparedProgramMatches } from './recovery-artifact-binding';
import { prepareStartJob } from './start-job-readiness';
import { streamResumeFromRawLine } from './start-job-resume-stream';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const NOW = '2026-09-24T00:00:00.000Z';
const STATUS: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  wco: { x: 0, y: 0, z: 0 },
  feed: 0,
  spindle: 0,
};
const originalStartJob = useLaserStore.getState().startJob;

type Burn = SmoothieBurn | MarlinBurn;

type Dialect = {
  readonly name: string;
  readonly controllerKind: ControllerKind;
  readonly device: Partial<DeviceProfile>;
  /** A line only the dialect's own re-arm writes. */
  readonly rearm: RegExp;
  readonly burns: (text: string, maxPowerS: number) => ReadonlyArray<Burn>;
};

const DIALECTS: ReadonlyArray<Dialect> = [
  {
    name: 'Smoothieware',
    controllerKind: 'smoothieware',
    device: { maxPowerS: 1 },
    rearm: /^M221 S100 P1$/m,
    burns: (text, maxPowerS) =>
      runSmoothieLines(powerUpSmoothie({ maximumS: maxPowerS }), text).burns,
  },
  {
    name: 'Marlin inline',
    controllerKind: 'marlin',
    device: { maxPowerS: 255, gcodeDialect: { dialectId: 'marlin-inline' } },
    rearm: /^M3 I S0$/m,
    burns: (text) => runMarlinLines(powerUpMarlin(), text).burns,
  },
  {
    name: 'Marlin fan',
    controllerKind: 'marlin',
    device: { maxPowerS: 255, gcodeDialect: { dialectId: 'marlin-fan' } },
    rearm: /^M106 S\d+$/m,
    burns: (text) => runMarlinLines(powerUpMarlin(), text).burns,
  },
];

beforeEach(() => {
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: STATUS,
    capabilities: grblDriver.capabilities,
    controllerSessionEpoch: 9,
    controllerSettings: { maxPowerS: 1_000, minPowerS: 0, laserModeEnabled: true },
    controllerSettingsObservation: { sessionEpoch: 9, observedAt: 1 },
    controllerQualification: { kind: 'qualified', epoch: 9, settings: 'verified' },
  });
});

afterEach(() => {
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.clearAllMocks();
});

// One constant-power stroke of two segments: the second relies on the modal
// power the first set.
function strokeProject(dialect: Dialect): Project {
  const base = createProject();
  return {
    ...base,
    device: { ...base.device, controllerKind: dialect.controllerKind, ...dialect.device },
    scene: {
      layers: [{ ...createLayer({ id: 'line', color: '#ff0000' }), powerMode: 'constant' }],
      objects: [
        {
          kind: 'imported-svg',
          id: 'line',
          source: 'line.svg',
          bounds: { minX: 1, minY: 1, maxX: 9, maxY: 9 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  points: [
                    { x: 1, y: 1 },
                    { x: 9, y: 9 },
                    { x: 9, y: 1 },
                  ],
                  closed: false,
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function prepared(dialect: Dialect) {
  const result = prepareStartJob(
    strokeProject(dialect),
    useLaserStore.getState().controllerSettings,
    { statusReport: STATUS, alarmCode: null, hasActiveStreamer: false },
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

/** The second burn move: its power is modal, so the resume must restore it. */
function secondBurnLine(dialect: Dialect, gcode: string, maxPowerS: number): number {
  const line = dialect.burns(gcode, maxPowerS)[1]?.line;
  if (line === undefined) throw new Error('Expected two burn moves.');
  return line;
}

function expectSameBurns(
  dialect: Dialect,
  gcode: string,
  resumed: string,
  fromLine: number,
  maxPowerS: number,
): void {
  const original = dialect
    .burns(gcode, maxPowerS)
    .filter((burn) => burn.line >= fromLine)
    .map(burnKey);
  expect(original.length).toBeGreaterThan(0);
  expect(dialect.burns(resumed, maxPowerS).map(burnKey)).toEqual(original);
}

async function interruptedCapsule(dialect: Dialect, repository: RecoveryRepository) {
  const job = prepared(dialect);
  const artifact = await createCurrentTestExecutionArtifact({
    runId: `interrupted-${dialect.name}`,
    gcode: job.gcode,
    prepared: job.prepared,
    canvasPlan: job.canvasPlan,
    controllerSettings: useLaserStore.getState().controllerSettings,
    controllerObservation: { statusReport: STATUS, wco: STATUS.wco },
  });
  expect((await repository.stageArtifact(artifact)).ok).toBe(true);
  await repository.activateFreshRun(artifact.runId);
  await repository.interruptRun(artifact.runId, 3, {
    kind: 'disconnect',
    message: 'Cable pulled.',
  });
  const capsule = repository.getSnapshot().recoveryCapsule;
  if (capsule === null) throw new Error('Expected a recovery capsule.');
  // The matching controller is connected and qualified.
  useLaserStore.setState({
    activeControllerKind: dialect.controllerKind,
    capabilities: selectControllerDriver(dialect.controllerKind).capabilities,
  });
  return { job, capsule };
}

function recoveryRepository(): RecoveryRepository {
  return new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => NOW,
  });
}

function activeArtifact(repository: RecoveryRepository): ExecutionArtifactV1 {
  const artifact = repository.getSnapshot().activeRun?.artifact;
  if (artifact?.kind !== 'exact-execution') throw new Error('Expected an exact artifact.');
  return artifact;
}

describe.each(DIALECTS)('laser resume on $name', (dialect) => {
  it('starts from line with the power commands of the program', async () => {
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });
    const job = prepared(dialect);
    const device = job.prepared.project.device;
    const fromLine = secondBurnLine(dialect, job.gcode, device.maxPowerS);

    const started = await streamResumeFromRawLine(
      job.prepared.project,
      job.gcode,
      fromLine,
      job.canvasPlan,
      captureLaserModeStartSnapshot(useLaserStore.getState()),
    );

    expect(jobAwareAlert).not.toHaveBeenCalled();
    expect(started).toBe(true);
    const expected = buildLaserResumeProgram(job.gcode, fromLine, device);
    if (expected.kind !== 'ok') throw new Error(expected.reason);
    const sent = expected.lines.join('\n');
    expect(startJob).toHaveBeenCalledWith(sent, expect.anything());
    expect(sent).toMatch(dialect.rearm);
    expectSameBurns(dialect, job.gcode, sent, fromLine, device.maxPowerS);
  });

  it('resumes a saved recovery with them, records transform 4 and replays the archive', async () => {
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });
    const repository = recoveryRepository();
    const { job, capsule } = await interruptedCapsule(dialect, repository);
    const device = job.prepared.project.device;
    const fromLine = secondBurnLine(dialect, job.gcode, device.maxPowerS);

    expect(await runLaserRecoveryCapsuleFlow(capsule, repository, { fromLine })).toBe(true);

    expect(jobAwareAlert).not.toHaveBeenCalled();
    const recovered = activeArtifact(repository);
    expect(startJob).toHaveBeenCalledWith(recovered.gcode, expect.anything());
    // Transform 4 (ADR-407) left these programs' resumes as transform 3 built them.
    expect(recovered.laserResumeChain).toEqual([{ fromLine, version: 4 }]);
    expect(recovered.gcode).toMatch(dialect.rearm);
    expectSameBurns(dialect, job.gcode, recovered.gcode, fromLine, device.maxPowerS);
    expect(recoveryArtifactPreparedProgramMatches(recovered)).toBe(true);
  });

  it('still replays a transform 2 step saved before this change, byte for byte', async () => {
    useLaserStore.setState({ startJob: vi.fn(async () => undefined) });
    const repository = recoveryRepository();
    const { job, capsule } = await interruptedCapsule(dialect, repository);
    const fromLine = secondBurnLine(dialect, job.gcode, job.prepared.project.device.maxPowerS);
    expect(await runLaserRecoveryCapsuleFlow(capsule, repository, { fromLine })).toBe(true);
    const recovered = activeArtifact(repository);
    // Transform 2 wrote GRBL power commands whatever the controller.
    const grblBytes = buildResumeProgram(job.gcode, fromLine, {
      machineKind: 'laser',
      safeZMm: 0,
      spindleSpinupSec: 0,
      plungeMmPerMin: 300,
      laserTransform: 2,
    });
    if (grblBytes.kind !== 'ok') throw new Error(grblBytes.reason);
    const gcode = grblBytes.lines.join('\n');
    const archived: ExecutionArtifactV1 = {
      ...recovered,
      gcode,
      fingerprint: fingerprintGcode(gcode),
      laserResumeChain: [{ fromLine, version: 2 }],
    };

    expect(gcode).not.toBe(recovered.gcode);
    expect(recoveryArtifactPreparedProgramMatches(archived)).toBe(true);
    // The transform recorded with a step decides its bytes, not the build.
    expect(
      recoveryArtifactPreparedProgramMatches({
        ...archived,
        laserResumeChain: [{ fromLine, version: 3 }],
      }),
    ).toBe(false);
  });
});
