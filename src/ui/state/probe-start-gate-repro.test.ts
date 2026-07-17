// Repro harness for the field report "after probing I still have to press
// Zero Z before Start" (operator flow: release motors -> hand position ->
// Set origin -> Z probe with touch plate). Drives the REAL store probe
// transaction against a fake serial connection (same harness as
// laser-probe-lifecycle.test.ts), then interrogates the CNC Start work-zero
// findings exactly as prepareStartJob does. Frame-first (ADR-228): the only
// Start policy gate is a completed Frame for the exact job, so the harness
// records a matching FrameVerification and the work-zero/tool findings are
// observed as Job Review warnings. Findings-only: no production code is
// modified by this file.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildZProbeLines } from '../../core/controllers/grbl';
import type { ProbeRequest } from '../../core/controllers/grbl/probe';
import { computeJobBounds, frameBoundsSignature } from '../../core/job';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import {
  CNC_NO_WORK_ZERO_START_MESSAGE,
  cncWorkZeroStartIssue,
} from '../laser/cnc-start-advisories';
import { prepareStartJob, type MachineStartSnapshot } from '../laser/start-job-readiness';
import {
  DEFAULT_JOB_PLACEMENT,
  resolveJobPlacement,
  type JobPlacementSettings,
} from '../job-placement';
import type { FrameVerification } from './frame-verification';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import {
  isWorkZZeroEvidenceCurrent,
  PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE,
} from './work-z-zero-evidence';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly emitClose: () => void;
};

const Z_REQUEST = {
  kind: 'z',
  params: {
    plateThicknessMm: 15,
    seekFeedMmPerMin: 150,
    probeFeedMmPerMin: 25,
    maxTravelMm: 25,
    retractMm: 5,
  },
} satisfies ProbeRequest;

// Minimal CNC project, built the same way as cnc-start-tool-evidence.test.ts.
const object: SceneObject = {
  kind: 'imported-svg',
  id: 'probe-gate-line',
  source: 'line.svg',
  bounds: { minX: 1, minY: 1, maxX: 9, maxY: 9 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 1, y: 1 },
            { x: 9, y: 9 },
          ],
        },
      ],
    },
  ],
};

const cncProject: Project = {
  ...createProject(),
  machine: DEFAULT_CNC_MACHINE_CONFIG,
  scene: {
    ...EMPTY_SCENE,
    objects: [object],
    layers: [createLayer({ id: 'red', color: '#ff0000' })],
  },
};
const controllerSettings = { maxPowerS: 12000, minPowerS: 0, laserModeEnabled: false };

function makeConnection(write: (data: string) => Promise<void>): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
  return {
    write,
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: (handler) => {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    close: async () => undefined,
    emitLine: (line) => {
      for (const handler of lineHandlers) handler(line);
    },
    emitClose: () => {
      for (const handler of closeHandlers) handler();
    },
  };
}

function makeAdapter(connection: SerialConnection): PlatformAdapter {
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

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 48; i += 1) await Promise.resolve();
}

// Ack every probe line, then prove settlement with two fresh Idle reports —
// the exact sequence laser-probe-lifecycle.test.ts validates line-by-line.
async function runSuccessfulZProbe(connection: FakeConnection, writes: string[]): Promise<void> {
  const probe = useLaserStore.getState().probe(Z_REQUEST);
  await flush();
  const expectedSequence = ['M5', 'M9', ...buildZProbeLines(Z_REQUEST.params), 'G4 P0.01'];
  for (let index = 0; index < expectedSequence.length; index += 1) {
    expect(writes[index]).toBe(`${expectedSequence[index]}\n`);
    connection.emitLine('ok');
    await flush();
  }
  connection.emitLine('<Idle|MPos:0.000,0.000,20.000|FS:0,0>');
  await flush();
  connection.emitLine('<Idle|MPos:0.000,0.000,20.000|FS:0,0>');
  await expect(probe).resolves.toEqual({ kind: 'ok' });
}

// The live-machine snapshot prepareStartJob receives, with evidence + epoch
// taken from the real laser store and the non-work-zero fields set to the
// same known-good values the existing cnc-start-tool-evidence.test.ts uses.
function machineSnapshotFromStore(
  frameVerification: FrameVerification | null = null,
): MachineStartSnapshot {
  const state = useLaserStore.getState();
  return {
    statusReport: state.statusReport,
    alarmCode: state.alarmCode,
    hasActiveStreamer: state.streamer !== null,
    ovCache: { feed: 100, rapid: 100, spindle: 100 },
    accessoryCache: { spindleCw: false, spindleCcw: false, flood: false, mist: false },
    workOriginActive: state.workOriginActive,
    wcoCache: state.wcoCache,
    workZZeroEvidence: state.workZZeroEvidence,
    workZReferenceEpoch: state.workZReferenceEpoch,
    frameVerification,
  };
}

// Frame-first (ADR-228): mirror dispatchFrameIfSafe's recording for this
// project/placement so the one remaining Start gate — a completed Frame for
// the exact compiled job — is satisfied and the work-zero findings under
// test stay observable.
function frameVerificationFromStore(
  placement: JobPlacementSettings = DEFAULT_JOB_PLACEMENT,
): FrameVerification {
  const state = useLaserStore.getState();
  const resolved = resolveJobPlacement(placement, {
    statusReport: state.statusReport,
    workOriginActive: state.workOriginActive,
    wcoCache: state.wcoCache,
  });
  if (!resolved.ok) throw new Error(`fixture placement failed: ${resolved.messages.join('; ')}`);
  const prepared = prepareOutput(
    cncProject,
    resolved.jobOrigin === undefined ? {} : { jobOrigin: resolved.jobOrigin },
  );
  if (!prepared.ok) throw new Error('fixture compile failed');
  const bounds = computeJobBounds(prepared.job, prepared.project.device);
  if (bounds === null) throw new Error('fixture job has no bounds');
  return {
    boundsSignature: frameBoundsSignature(bounds),
    wco: state.wcoCache,
    workOriginActive: state.workOriginActive,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  // The store probe reads the ACTIVE bit from the project store when it
  // records evidence (laser-probe-actions.ts: selectedCncToolId).
  useStore.setState({ project: cncProject });
});

afterEach(async () => {
  vi.useRealTimers();
  if (useLaserStore.getState().connection.kind !== 'disconnected') {
    await useLaserStore.getState().disconnect();
  }
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastWriteError: null,
    safetyNotice: null,
    probeBusy: false,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    pendingUntrackedAcks: 0,
    workOriginActive: false,
    workOriginSource: 'none',
    workZZeroEvidence: null,
    workZReferenceEpoch: 0,
    wcoCache: null,
    frameVerification: null,
    log: [],
  });
  useStore.setState({ project: createProject() });
  vi.restoreAllMocks();
});

describe('probe -> CNC Start work-zero gate (field repro: "cannot start without Zero Z")', () => {
  it('case 1: a settled probe + plate-removal confirmation fully satisfies the Start gate', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    const probeEpoch = useLaserStore.getState().workZReferenceEpoch + 1;
    await runSuccessfulZProbe(connection, writes);

    const afterProbe = useLaserStore.getState();
    expect(afterProbe.workZZeroEvidence).toMatchObject({
      source: 'probe',
      referenceEpoch: probeEpoch,
      toolId: 'em-3175',
      probePlateRemoved: false,
    });

    // BEFORE the operator confirms plate removal, the work-zero finding must
    // surface — with the plate-removal message, NOT "no work zero". Under
    // frame-first (ADR-228) it reaches the operator as a Job Review warning
    // rather than a Start block, but the wrong message would still coach a
    // redundant Zero Z (manual-zero evidence has no plate flag) — the exact
    // operator behavior in the bug report.
    expect(
      cncWorkZeroStartIssue(
        cncProject,
        afterProbe.workZZeroEvidence,
        afterProbe.workZReferenceEpoch,
      ),
    ).toBe(PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE);

    useLaserStore.getState().confirmProbePlateRemoved();

    const confirmed = useLaserStore.getState();
    expect(confirmed.workZZeroEvidence).toMatchObject({
      source: 'probe',
      referenceEpoch: probeEpoch,
      toolId: 'em-3175',
      probePlateRemoved: true,
    });
    expect(
      cncWorkZeroStartIssue(cncProject, confirmed.workZZeroEvidence, confirmed.workZReferenceEpoch),
    ).toBeNull();

    const prepared = prepareStartJob(
      cncProject,
      controllerSettings,
      machineSnapshotFromStore(frameVerificationFromStore()),
    );
    expect(prepared).toMatchObject({ ok: true });
    if (prepared.ok) {
      expect(prepared.cncToolPlan).toEqual([{ id: 'em-3175', name: '3.175 mm (1/8") end mill' }]);
      expect(prepared.warnings.join('\n')).not.toContain(CNC_NO_WORK_ZERO_START_MESSAGE);
      expect(prepared.warnings.join('\n')).not.toContain(PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE);
    }
  });

  it('case 2: the WCO-bearing status frame GRBL sends after G10 L20 does not stale the evidence', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    await runSuccessfulZProbe(connection, writes);
    useLaserStore.getState().confirmProbePlateRemoved();
    const before = useLaserStore.getState();
    const evidenceBefore = before.workZZeroEvidence;
    const epochBefore = before.workZReferenceEpoch;

    // GRBL reports WCO on the next status frame after a G10 L20 offset write.
    // XY carries the hand-set G92 origin; Z carries the probed plate offset.
    connection.emitLine('<Idle|MPos:120.000,80.000,20.000|FS:0,0|WCO:120.000,80.000,15.000>');
    await flush();
    connection.emitLine('<Idle|MPos:120.000,80.000,20.000|FS:0,0|WCO:120.000,80.000,15.000>');
    await flush();

    const after = useLaserStore.getState();
    expect(after.workZReferenceEpoch).toBe(epochBefore);
    expect(after.workZZeroEvidence).toEqual(evidenceBefore);
    expect(isWorkZZeroEvidenceCurrent(after.workZZeroEvidence, after.workZReferenceEpoch)).toBe(
      true,
    );
    expect(
      cncWorkZeroStartIssue(cncProject, after.workZZeroEvidence, after.workZReferenceEpoch),
    ).toBeNull();

    const userOriginPlacement: JobPlacementSettings = {
      startFrom: 'user-origin',
      anchor: 'front-left',
    };
    const prepared = prepareStartJob(
      cncProject,
      controllerSettings,
      machineSnapshotFromStore(frameVerificationFromStore(userOriginPlacement)),
      userOriginPlacement,
    );
    // Reveal the blocking messages verbatim on failure.
    expect(prepared.ok ? [] : prepared.messages).toEqual([]);
    expect(prepared.ok).toBe(true);
  });

  it('case 3: probing with a different Active bit than the job starts with surfaces the tool warning', async () => {
    // Operator probed while the 1/4" bit was selected as Active...
    useStore.setState({
      project: { ...cncProject, machine: { ...DEFAULT_CNC_MACHINE_CONFIG, toolId: 'em-6350' } },
    });
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    await runSuccessfulZProbe(connection, writes);
    useLaserStore.getState().confirmProbePlateRemoved();
    const state = useLaserStore.getState();
    expect(state.workZZeroEvidence).toMatchObject({ source: 'probe', toolId: 'em-6350' });

    // ...but the compiled job's first cutter section resolves to the default
    // em-3175 bit. The work-zero finding itself passes; the TOOL mismatch
    // surfaces — under frame-first (ADR-228) as a Job Review warning, not a
    // Start block — and with the tool message, never "no work zero".
    expect(
      cncWorkZeroStartIssue(cncProject, state.workZZeroEvidence, state.workZReferenceEpoch),
    ).toBeNull();

    const prepared = prepareStartJob(
      cncProject,
      controllerSettings,
      machineSnapshotFromStore(frameVerificationFromStore()),
    );
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(prepared.warnings).toContain(
        'This job starts with 3.175 mm (1/8") end mill, but work Z was established for ' +
          '6.35 mm (1/4") end mill. Load 3.175 mm (1/8") end mill, select it as the Active bit, ' +
          'then touch it to the stock top and Zero Z — or probe again.',
      );
      expect(prepared.warnings.join('\n')).not.toContain(CNC_NO_WORK_ZERO_START_MESSAGE);
    }
  });
});
