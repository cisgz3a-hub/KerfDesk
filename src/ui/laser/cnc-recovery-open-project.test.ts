// Rolling audit v3 G2-P1-1 (ADR-416 Amendment 3): CNC pass and supervised
// recovery streamed the saved CNC job whatever project was open. With a Laser
// project open, the job lock then pinned Laser, and the bit-change hold's point
// move went out with no safe-Z lift and no Work-Z check. These drive the real
// recovery flows and the real startJob against a fake GRBL 1.1.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  machineKindOf,
  type CncMachineConfig,
  type Project,
  type SceneObject,
} from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useStore } from '../state';
import { CNC_SETUP_ATTESTATION_PROMPT } from '../state/cnc-setup-attestation';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { CNC_POINT_MOVE_WORK_Z_MESSAGE } from '../state/laser-jog-actions';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { respondToTestGrblBuildInfo } from '../state/laser-test-start-helpers';
import type { RecoveryCapsule, RecoveryRepository } from '../state/recovery';
import { resetStore } from '../state/test-helpers';
import { captureWorkZZeroEvidence } from '../state/work-z-zero-evidence';
import { runCncPassRecoveryFlow } from './cnc-pass-recovery-flow';
import { repository, saveInterruptedRun } from './cnc-pass-recovery-flow-test-fixtures';
import type { CncPassRecoveryReview } from './cnc-pass-recovery-review';
import { CNC_RECOVERY_NEEDS_CNC_PROJECT } from './cnc-recovery-open-project';
import { runCncSupervisedRecoveryFlow } from './cnc-supervised-recovery-flow';
import { frameVerificationForProject } from './frame-verification-testing';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const IDLE = '<Idle|MPos:10.000,20.000,-1.000|FS:0,0|WCO:0.000,0.000,0.000|Ov:100,100,100>';
// The saved job's own safe Z, unlike the default 3.81 mm of any other project.
const JOB_SAFE_Z_MM = 6;

type Device = SerialConnection & { readonly say: (line: string) => void };

function makeDevice(sent: string[]): Device {
  const handlers = new Set<(line: string) => void>();
  const device: Device = {
    write: async (data) => {
      sent.push(data);
      if (data === '?') setTimeout(() => device.say(IDLE), 0);
      if (data === 'G4 P0.01\n' || data.startsWith('$J=')) setTimeout(() => device.say('ok'), 5);
      respondToTestGrblBuildInfo(data, device.say);
    },
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    say: (line) => {
      for (const handler of handlers) handler(line);
    },
  };
  return device;
}

function adapterFor(connection: SerialConnection): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({ open: async () => connection }),
    },
  };
}

async function settle(ms = 20): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

/** An open line from x 10 to 70 at height `y`, through the given inner xs. */
function line(
  id: string,
  color: string,
  y: number,
  innerXs: ReadonlyArray<number> = [40],
): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 10, minY: y, maxX: 70, maxY: y },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [{ points: [10, ...innerXs, 70].map((x) => ({ x, y })), closed: false }],
      },
    ],
  };
}

const JOB_MACHINE: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, safeZMm: JOB_SAFE_Z_MM },
};

// Scene-data colours for the two layers' artwork.
const RED = '#ff0000';
const BLUE = '#0000ff';

// A two-bit CNC job: the 3.175 mm end mill, then a bit change to the 6.35 mm.
function twoBitProject(): Project {
  return {
    ...createProject({
      ...DEFAULT_DEVICE_PROFILE,
      streamingMode: 'ping-pong' as const,
      rxBufferBytes: 96,
    }),
    machine: JOB_MACHINE,
    scene: {
      ...EMPTY_SCENE,
      objects: [line('a', RED, 10), line('b', BLUE, 30)],
      layers: [
        {
          ...createLayer({ id: 'red', color: RED }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, depthMm: 1, depthPerPassMm: 1, toolId: 'em-3175' },
        },
        {
          ...createLayer({ id: 'blue', color: BLUE }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, depthMm: 1, depthPerPassMm: 1, toolId: 'em-6350' },
        },
      ],
    },
  };
}

// The supervised runway review's own fixture: one bit, one straight contour of
// three 20 mm segments, so the selected segment has a cleared tangent runway.
function runwayProject(): Project {
  return {
    ...twoBitProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [line('a', RED, 10, [30, 50])],
      layers: [createLayer({ id: 'red', color: RED })],
    },
  };
}

const PASS_REVIEW: CncPassRecoveryReview = {
  cutterClear: true,
  spindleStopped: true,
  workholdingConfirmed: true,
  toolConfirmed: true,
  position: { kind: 're-zeroed' },
  groupIndex: 0,
  passIndex: 0,
};

const SUPERVISED_REVIEW = {
  uncertaintyEventId: 'cnc-op-1/pass-1/cut-2',
  qualificationId: 'air-cut-2026-10-27',
  cutterClear: true,
  spindleStopped: true,
  positionRequalified: true,
  toolInspected: true,
  workholdingConfirmed: true,
  priorWorkConfirmed: true,
  clearedPathConfirmed: true,
} as const;

let sent: string[] = [];
let device: Device;

/** Connects a qualified GRBL 1.1, archives an interrupted CNC run (two bits by
 *  default) with its CNC project open, and returns its capsule. */
async function interruptedRun(
  repo: RecoveryRepository,
  project: Project = twoBitProject(),
): Promise<RecoveryCapsule> {
  useStore.setState({ project });
  sent = [];
  device = makeDevice(sent);
  await useLaserStore.getState().connect(adapterFor(device));
  device.say('Grbl 1.1f');
  device.say(IDLE);
  await settle(0);
  device.say('ok');
  device.say(IDLE);
  await settle();
  const connected = useLaserStore.getState();
  useLaserStore.setState({
    controllerSettings: {
      maxPowerS: 12_000,
      minPowerS: 0,
      laserModeEnabled: false,
      reportInches: false,
    },
    controllerQualification: {
      kind: 'qualified',
      epoch: connected.controllerSessionEpoch,
      settings: 'verified',
    },
    ovCache: { feed: 100, rapid: 100, spindle: 100 },
    accessoryCache: { spindleCw: false, spindleCcw: false, flood: false, mist: false },
    workZZeroEvidence: {
      source: 'manual-zero',
      referenceEpoch: connected.workZReferenceEpoch ?? 0,
      toolId: 'em-3175',
    },
    frameVerification: frameVerificationForProject(project),
  });
  return saveInterruptedRun(repo);
}

/** Acknowledges the stream until it holds at the bit change, then reports Idle. */
async function streamToBitChange(): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    await settle(2);
    const streamer = useLaserStore.getState().streamer;
    if (streamer?.status === 'tool-change') break;
    if ((streamer?.inFlight.length ?? 0) > 0) device.say('ok');
  }
  for (let i = 0; i < 2; i += 1) {
    device.say(IDLE);
    await settle();
  }
}

/** Every G-code line of the recovery program the fake controller received. */
function jobLinesSent(): ReadonlyArray<string> {
  return sent.filter((data) => /^(G0|G1|M3|M5)\b/m.test(data));
}

function alerts(): ReadonlyArray<string> {
  return vi.mocked(jobAwareAlert).mock.calls.map((call) => String(call[0]));
}

/** The recovery offer is still on its card, with no live claim. */
function expectOfferKept(repo: RecoveryRepository, capsule: RecoveryCapsule): void {
  const kept = repo.getSnapshot().recoveryCapsule;
  expect(kept?.runId).toBe(capsule.runId);
  expect(kept?.claim).toBeUndefined();
  expect(useLaserStore.getState().streamer).toBeNull();
}

/** Turns the toolbar to Laser while the CNC setup attestation is open, the
 *  last dialog before the claim and the controller Start. */
function switchToLaserAtAttestation(): void {
  vi.mocked(jobAwareConfirm).mockImplementation((message) => {
    if (message === CNC_SETUP_ATTESTATION_PROMPT) useStore.getState().setMachineKind('laser');
    return true;
  });
}

async function pointMoveFirstJog(): Promise<{
  readonly jog: string | undefined;
  readonly error: unknown;
}> {
  sent.length = 0;
  let error: unknown = null;
  const move = useLaserStore
    .getState()
    .jogToMachinePosition(60, 70, 1000)
    .catch((caught: unknown) => {
      error = caught;
    });
  await settle(50);
  const jog = sent.find((data) => data.startsWith('$J='));
  await useLaserStore.getState().disconnect();
  await move;
  return { jog, error };
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(jobAwareAlert).mockClear();
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  useStore.setState({ project: createProject() });
  localStorage.clear();
  vi.restoreAllMocks();
});

type RecoveryEntry = {
  readonly project: () => Project;
  readonly run: (capsule: RecoveryCapsule, repo: RecoveryRepository) => Promise<boolean>;
};

const ENTRY_POINTS: ReadonlyArray<readonly [string, RecoveryEntry]> = [
  [
    'pass',
    {
      project: twoBitProject,
      run: (capsule, repo) => runCncPassRecoveryFlow(capsule, PASS_REVIEW, repo),
    },
  ],
  [
    'supervised',
    {
      project: runwayProject,
      run: (capsule, repo) => runCncSupervisedRecoveryFlow(capsule, SUPERVISED_REVIEW, repo),
    },
  ],
];

describe('CNC recovery with a Laser project open (G2-P1-1)', () => {
  it.each(ENTRY_POINTS)(
    'refuses %s recovery before any dialog and keeps the offer',
    async (_name, { project, run }) => {
      const repo = repository();
      const capsule = await interruptedRun(repo, project());
      expect(useStore.getState().setMachineKind('laser')).toMatchObject({ kind: 'selected' });
      sent.length = 0;

      const started = await run(capsule, repo);

      expect(started).toBe(false);
      expect(alerts()).toEqual([`Cannot start CNC recovery:\n\n${CNC_RECOVERY_NEEDS_CNC_PROJECT}`]);
      expect(jobAwareConfirm).not.toHaveBeenCalled();
      expect(jobLinesSent()).toEqual([]);
      expectOfferKept(repo, capsule);
    },
    30_000,
  );

  it.each(ENTRY_POINTS)(
    'refuses %s recovery at the final Start assertion when Laser is chosen during the dialogs',
    async (_name, { project, run }) => {
      const repo = repository();
      const capsule = await interruptedRun(repo, project());
      switchToLaserAtAttestation();
      sent.length = 0;

      const started = await run(capsule, repo);

      expect(started).toBe(false);
      expect(alerts()).toEqual([
        `Could not start CNC recovery:\n\n${CNC_RECOVERY_NEEDS_CNC_PROJECT}`,
      ]);
      expect(machineKindOf(useStore.getState().project.machine)).toBe('laser');
      expect(jobLinesSent()).toEqual([]);
      expectOfferKept(repo, capsule);
    },
    30_000,
  );
});

describe('a running CNC recovery keeps its own machine in the bit-change hold (G2-P1-1)', () => {
  it('lifts a point move to the saved job safe Z with another CNC project open', async () => {
    const repo = repository();
    const capsule = await interruptedRun(repo);
    // Another CNC project, on the default 3.81 mm safe Z.
    useStore.setState({ project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG } });

    expect(await runCncPassRecoveryFlow(capsule, PASS_REVIEW, repo)).toBe(true);
    await streamToBitChange();

    const held = useLaserStore.getState();
    expect(held.streamer?.status).toBe('tool-change');
    expect(held.activeJobMachineKind).toBe('cnc');
    expect(held.activeJobSafeZMm).toBe(JOB_SAFE_Z_MM);
    useLaserStore.setState({
      workZZeroEvidence: captureWorkZZeroEvidence('manual-zero', held.workZReferenceEpoch),
    });

    const { jog } = await pointMoveFirstJog();

    expect(jog).toBe(`$J=G90 G21 Z${JOB_SAFE_Z_MM.toFixed(3)} F1000\n`);
  }, 30_000);

  it('checks Work Z, lifts, and lets the toolbar back to CNC when the open project turned Laser', async () => {
    const repo = repository();
    const capsule = await interruptedRun(repo);
    expect(await runCncPassRecoveryFlow(capsule, PASS_REVIEW, repo)).toBe(true);
    await streamToBitChange();
    expect(useLaserStore.getState().streamer?.status).toBe('tool-change');

    // The lock keeps the job's mode against the toolbar...
    useStore.getState().setMachineKind('laser');
    expect(machineKindOf(useStore.getState().project.machine)).toBe('cnc');
    // ...and should any other path leave a Laser project open, the hold still
    // moves as CNC: no Work Z for the new bit yet, so the point move is refused.
    useStore.setState({ project: createProject() });
    const refused = await pointMoveFirstJog();
    expect(refused.jog).toBeUndefined();
    expect(refused.error).toBeInstanceOf(Error);
    expect((refused.error as Error).message).toBe(CNC_POINT_MOVE_WORK_Z_MESSAGE);
  }, 30_000);

  it('sends the job safe-Z lift first once Work Z is set, and the toolbar can return to CNC', async () => {
    const repo = repository();
    const capsule = await interruptedRun(repo);
    expect(await runCncPassRecoveryFlow(capsule, PASS_REVIEW, repo)).toBe(true);
    await streamToBitChange();
    useStore.setState({ project: createProject() });

    // The job's own mode stays selectable, so its probe and bit list return;
    // once there, the lock keeps it.
    useStore.getState().setMachineKind('cnc');
    expect(machineKindOf(useStore.getState().project.machine)).toBe('cnc');
    useStore.getState().setMachineKind('laser');
    expect(machineKindOf(useStore.getState().project.machine)).toBe('cnc');

    useStore.setState({ project: createProject() });
    const held = useLaserStore.getState();
    useLaserStore.setState({
      workZZeroEvidence: captureWorkZZeroEvidence('manual-zero', held.workZReferenceEpoch),
    });
    const { jog } = await pointMoveFirstJog();

    expect(jog).toBe(`$J=G90 G21 Z${JOB_SAFE_Z_MM.toFixed(3)} F1000\n`);
  }, 30_000);
});
