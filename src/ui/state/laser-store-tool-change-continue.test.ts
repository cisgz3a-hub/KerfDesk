// F22: continuing a tool-change hold whose next section fits the RX buffer lands
// directly in the following hold within a single fill. The ack-path transition
// patch never sees it, so runContinueToolChange must apply the hold-entry patch
// itself. Split from laser-store-tool-change.test.ts to stay under the size cap;
// a trimmed local serial harness keeps this file self-contained.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import { createProject } from '../../core/scene';
import { TOOL_CHANGE_LOAD_PREFIX } from '../../core/output';
import type { CanvasMotionPlan } from './canvas-motion-plan';
import { canvasJobTimingPlan } from './canvas-job-timing-plan';
import {
  cncControllerEpochOf,
  createCncSetupAttestation,
  type CncSetupAttestation,
} from './cnc-setup-attestation';
import { useStore } from './store';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };
type ProgramWriteControl = { gate: Promise<void> | null };

const IDLE = '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>';
const INITIAL_POSITION = { x: 0, y: 0, z: 0 };

function makeConnection(writes: string[], writeControl?: ProgramWriteControl): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const connection: FakeConnection = {
    write: async (data) => {
      writes.push(data);
      if (data === 'G4 P0.01\n') setTimeout(() => connection.emitLine('ok'), 0);
      if (data === '?') setTimeout(() => connection.emitLine(IDLE), 0);
      if (
        data === '$I\n' &&
        useLaserStore.getState().controllerOperation?.kind === 'connection-handshake'
      ) {
        connection.emitLine('[VER:1.1h.20190830:test]');
        connection.emitLine('[OPT:VM,15,128]');
        connection.emitLine('ok');
      }
      const gate = writeControl?.gate;
      if (
        (data.includes('G1 X1 Y1 F600') || data.includes('M3 S12000')) &&
        gate !== null &&
        gate !== undefined
      ) {
        await gate;
      }
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine: (line) => {
      for (const handler of lineHandlers) handler(line);
    },
  };
  return connection;
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForToolChangeStream(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (useLaserStore.getState().streamer?.status === 'tool-change') return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  throw new Error('Timed out waiting for the tool-change stream.');
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

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  connection.emitLine(IDLE);
  await flush();
  connection.emitLine('ok');
  connection.emitLine(IDLE);
  await flush();
}

function currentCncSetupAttestation(gcode: string): CncSetupAttestation {
  return createCncSetupAttestation(gcode, cncControllerEpochOf(useLaserStore.getState()));
}

function currentPositionEpoch(): number {
  return useLaserStore.getState().trustedPositionEpoch ?? 0;
}

function expectStreamStatus(status: 'streaming' | 'tool-change'): void {
  expect(useLaserStore.getState().streamer?.status).toBe(status);
}

function expectCountdownState(
  lifecycle: 'running' | 'paused' | 'tool-change',
  timing: 'running' | 'paused',
): void {
  const liveRun = useLaserStore.getState().liveCanvasRun;
  expect(liveRun?.lifecycle).toBe(lifecycle);
  expect(liveRun?.timing?.kind).toBe(timing);
}

// Three tools = two M0 holds, with a SHORT middle section that fits the RX
// buffer whole: continuing from hold 1 lands directly in hold 2 within one fill.
const CNC_THREE_TOOL = [
  'G1 X1 Y1 F600',
  'G0 Z5',
  'M5',
  'G0 X0 Y0',
  `${TOOL_CHANGE_LOAD_PREFIX}6.35 mm end mill`,
  'M0',
  'G0 Z5',
  'M3 S12000',
  'M5',
  'G0 X0 Y0',
  `${TOOL_CHANGE_LOAD_PREFIX}3.0 mm end mill`,
  'M0',
  'G0 Z5',
  'M3 S9000',
  'G1 X3 Y3',
].join('\n');

const CNC_THREE_PLAN = [
  { id: 'em-3175', name: '3.175 mm end mill' },
  { id: 'em-6350', name: '6.35 mm end mill' },
  { id: 'em-3000', name: '3.0 mm end mill' },
];

function countdownCanvasPlan(positionEpoch: number): CanvasMotionPlan {
  const manifest = buildMotionManifest(CNC_THREE_TOOL, {
    machineKind: 'cnc',
    initialPosition: INITIAL_POSITION,
  });
  return {
    manifest,
    fingerprint: fingerprintGcode(CNC_THREE_TOOL),
    retentionKey: 'three-tool-countdown',
    machineKind: 'cnc',
    device: DEFAULT_DEVICE_PROFILE,
    coordinateFrame: { kind: 'machine', workOffsetMm: INITIAL_POSITION },
    framePerimeter: [],
    jobStart: null,
    approachFrom: null,
    capability: 'realtime',
    unavailableReason: null,
    resumed: false,
    positionEpoch,
  };
}

function countdownTimingPlan() {
  const laser = useLaserStore.getState();
  return canvasJobTimingPlan(CNC_THREE_TOOL, DEFAULT_DEVICE_PROFILE, INITIAL_POSITION, {
    controllerSessionEpoch: laser.controllerSessionEpoch,
    positionEpoch: laser.trustedPositionEpoch,
    activeControllerKind: laser.activeControllerKind,
    detectedControllerKind: laser.detectedControllerKind,
  });
}

function startCountdownJob(): Promise<void> {
  return useLaserStore.getState().startJob(CNC_THREE_TOOL, {
    machineKind: 'cnc',
    cncToolPlan: CNC_THREE_PLAN,
    cncSetupAttestation: currentCncSetupAttestation(CNC_THREE_TOOL),
    canvasPlan: countdownCanvasPlan(currentPositionEpoch()),
    jobTimingPlan: countdownTimingPlan(),
  });
}

async function settleToolChange(connection: FakeConnection, toolId: string): Promise<void> {
  while ((useLaserStore.getState().streamer?.inFlight.length ?? 0) > 0) {
    connection.emitLine('ok');
    await flush();
  }
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  useLaserStore.setState({
    workZZeroEvidence: {
      source: 'manual-zero',
      referenceEpoch: useLaserStore.getState().workZReferenceEpoch,
      toolId,
    },
  });
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    streamer: null,
  });
  useStore.setState({ project: createProject() });
  vi.restoreAllMocks();
});

describe('CNC tool-change Continue into the next hold (F22)', () => {
  it('invalidates Z evidence and advances the label when Continue lands directly in the next hold', async () => {
    const writes: string[] = [];
    const writeControl: ProgramWriteControl = { gate: null };
    const connection = makeConnection(writes, writeControl);
    await connectWith(connection);
    writes.length = 0;

    await startCountdownJob();
    // Hold 1 — the pending bit is tool 2.
    expectStreamStatus('tool-change');
    expect(useLaserStore.getState().pendingToolId).toBe('em-6350');
    expectCountdownState('running', 'running');

    // Host M0 ownership arrives before the already-buffered pre-M0 tail is
    // physically stopped. Fresh Run evidence keeps the execution clock live.
    connection.emitLine('<Run|MPos:0.500,0.500,0.000|FS:600,12000>');
    await flush();
    expectCountdownState('running', 'running');

    // Drain hold 1's pre-M0 tail and observe a fresh Idle, then touch off tool 2.
    await settleToolChange(connection, 'em-6350');
    expectCountdownState('tool-change', 'paused');

    // The whole tool-2 section fits the buffer, so this single fill resumes and
    // lands straight in hold 2.
    writes.length = 0;
    const continueWrite = deferred();
    writeControl.gate = continueWrite.promise;
    const continuing = useLaserStore.getState().continueToolChange();
    await flush();
    expectStreamStatus('tool-change');
    expectCountdownState('tool-change', 'paused');
    continueWrite.resolve();
    await continuing;
    writeControl.gate = null;
    expectCountdownState('running', 'running');
    expect(writes.join('')).toContain('M3 S12000');
    expect(writes.join('')).not.toContain('M3 S9000'); // tool-3 section not sent

    // Entering the next hold must void tool 2's Z evidence and re-point the
    // pending label/id at tool 3 — so Continue cannot proceed on the wrong bit.
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    expect(useLaserStore.getState().pendingToolId).toBe('em-3000');
    expect(useLaserStore.getState().pendingToolLabel).toBe('3.0 mm end mill');
    expect(useLaserStore.getState().toolChangeIdleSeen).toBe(false);

    // After the second hold settles and tool 3 is touched off, a normal
    // Continue must resume both the stream and its frozen countdown.
    await settleToolChange(connection, 'em-3000');
    expectCountdownState('tool-change', 'paused');

    await useLaserStore.getState().continueToolChange();
    expectStreamStatus('streaming');
    expectCountdownState('running', 'running');
  });

  it('does not restart a physically settled hold when Start transport resolves late', async () => {
    const writes: string[] = [];
    const startWrite = deferred();
    const writeControl: ProgramWriteControl = { gate: startWrite.promise };
    const connection = makeConnection(writes, writeControl);
    await connectWith(connection);

    const starting = startCountdownJob();
    await waitForToolChangeStream();
    await settleToolChange(connection, 'em-6350');
    expectCountdownState('tool-change', 'paused');

    startWrite.resolve();
    await starting;
    expectCountdownState('tool-change', 'paused');
  });

  it.each([
    ['Hold', '<Hold:0|MPos:0.000,0.000,0.000|FS:0,0>'],
    ['Door', '<Door:0|MPos:0.000,0.000,0.000|FS:0,0>'],
  ])('does not overwrite a fresh %s pause when Start transport resolves late', async (_, line) => {
    const startWrite = deferred();
    const writeControl: ProgramWriteControl = { gate: startWrite.promise };
    const connection = makeConnection([], writeControl);
    await connectWith(connection);

    const starting = startCountdownJob();
    await waitForToolChangeStream();
    connection.emitLine(line);
    await flush();
    expectCountdownState('paused', 'paused');

    startWrite.resolve();
    await starting;
    expectCountdownState('paused', 'paused');
  });
});
