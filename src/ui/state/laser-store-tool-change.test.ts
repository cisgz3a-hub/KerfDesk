// CNC-01..03 activation — a multi-tool CNC job holds at the M0 (never sent),
// and continueToolChange resumes it. A laser job's M0 streams through. Drives
// the real store over a fake serial port, the same path the app takes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { createProject } from '../../core/scene';
import { TOOL_CHANGE_LOAD_PREFIX } from '../../core/output';
import {
  CNC_SETUP_ATTESTATION_REQUIRED_MESSAGE,
  cncControllerEpochOf,
  createCncSetupAttestation,
  type CncSetupAttestation,
} from './cnc-setup-attestation';
import { TOOL_CHANGE_PLAN_MISMATCH_MESSAGE } from './laser-job-actions';
import { useStore } from './store';
import { useLaserStore } from './laser-store';
import { TOOL_CHANGE_Z_ZERO_REQUIRED_MESSAGE } from './laser-store-helpers';
import { PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE } from './work-z-zero-evidence';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly releaseBlockedWrite: () => void;
};

type LiveStatusMode =
  | 'off'
  | 'active'
  | 'override'
  | 'encoder-fault'
  | 'reboot'
  | 'fence-error'
  | 'transport-backpressure';

function makeConnection(writes: string[], statusMode: LiveStatusMode = 'off'): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  let releaseBlockedWrite: (() => void) | null = null;
  const connection: FakeConnection = {
    write: async (data) => {
      writes.push(data);
      if (statusMode === 'transport-backpressure' && data === '$G\n') {
        await new Promise<void>((resolve) => {
          releaseBlockedWrite = resolve;
        });
      }
      if (data === 'G4 P0.01\n') {
        const response =
          statusMode === 'reboot' ? 'Grbl 1.1f' : statusMode === 'fence-error' ? 'error:20' : 'ok';
        setTimeout(() => connection.emitLine(response), 0);
      }
      if (data === '?') {
        const suffix =
          statusMode === 'active'
            ? '|Ov:100,100,100|A:S'
            : statusMode === 'override'
              ? '|Ov:110,100,100'
              : statusMode === 'encoder-fault'
                ? '|Ov:100,100,100|A:E'
                : '|Ov:100,100,100';
        setTimeout(() => {
          connection.emitLine(`<Idle|MPos:0.000,0.000,0.000|FS:0,0${suffix}>`);
        }, 0);
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
    releaseBlockedWrite: () => {
      releaseBlockedWrite?.();
      releaseBlockedWrite = null;
    },
  };
  return connection;
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
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  await flush();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>');
  await flush();
}

function currentCncSetupAttestation(gcode: string): CncSetupAttestation {
  return createCncSetupAttestation(gcode, cncControllerEpochOf(useLaserStore.getState()));
}

// pre-M0 section, M0 boundary, spindle-off clearance, spin-up + second section.
const CNC_MULTI_TOOL = [
  'G1 X1 Y1 F600',
  'G0 Z5',
  'M5',
  'G0 X0 Y0',
  // The CNC emitter writes the next bit as a comment before each M0 (R5); the
  // streamer strips it, so the sender extracts it at Start to name the hold.
  `${TOOL_CHANGE_LOAD_PREFIX}6.35 mm end mill`,
  'M0',
  'G0 Z5',
  'M3 S12000',
  'G1 X2 Y2',
].join('\n');

const CNC_TOOL_PLAN = [
  { id: 'em-3175', name: '3.175 mm end mill' },
  { id: 'em-6350', name: '6.35 mm end mill' },
];

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

describe('CNC tool-change activation (CNC-01..03)', () => {
  it('rechecks live accessory evidence at the store boundary before arming', async () => {
    const writes: string[] = [];
    await connectWith(makeConnection(writes, 'active'));
    writes.length = 0;

    // The older snapshot says off, but the post-confirmation live reports say
    // spindle on. No program byte may be armed from the stale snapshot.
    await expect(
      useLaserStore.getState().startJob(CNC_MULTI_TOOL, {
        machineKind: 'cnc',
        cncSetupAttestation: currentCncSetupAttestation(CNC_MULTI_TOOL),
      }),
    ).rejects.toThrow(/clockwise spindle/i);

    expect(writes).toContain('G4 P0.01\n');
    expect(writes).toContain('?');
    expect(writes.join('')).not.toContain('G1 X1 Y1');
    expect(useLaserStore.getState().streamer).toBeNull();
  });

  it('rechecks live overrides at the store boundary before arming', async () => {
    const writes: string[] = [];
    await connectWith(makeConnection(writes, 'override'));
    writes.length = 0;

    await expect(
      useLaserStore.getState().startJob(CNC_MULTI_TOOL, {
        machineKind: 'cnc',
        cncSetupAttestation: currentCncSetupAttestation(CNC_MULTI_TOOL),
      }),
    ).rejects.toThrow(/feed 110%/i);

    expect(writes).toContain('G4 P0.01\n');
    expect(writes).toContain('?');
    expect(writes.join('')).not.toContain('G1 X1 Y1');
    expect(useLaserStore.getState().streamer).toBeNull();
  });

  it('blocks a fresh grblHAL spindle encoder fault before arming', async () => {
    const writes: string[] = [];
    await connectWith(makeConnection(writes, 'encoder-fault'));
    writes.length = 0;

    await expect(
      useLaserStore.getState().startJob(CNC_MULTI_TOOL, {
        machineKind: 'cnc',
        cncSetupAttestation: currentCncSetupAttestation(CNC_MULTI_TOOL),
      }),
    ).rejects.toThrow(/spindle encoder fault/i);

    expect(writes).toEqual(['G4 P0.01\n', '?']);
    expect(useLaserStore.getState().streamer).toBeNull();
  });

  it('reserves the arming window against concurrent console accessory commands', async () => {
    const writes: string[] = [];
    await connectWith(makeConnection(writes));
    writes.length = 0;

    const starting = useLaserStore.getState().startJob(CNC_MULTI_TOOL, {
      machineKind: 'cnc',
      cncSetupAttestation: currentCncSetupAttestation(CNC_MULTI_TOOL),
    });
    expect(useLaserStore.getState().controllerOperation?.kind).toBe('start-arming');
    await expect(useLaserStore.getState().sendConsoleCommand('M8')).rejects.toThrow(
      /controller operation/i,
    );
    await starting;

    expect(writes).not.toContain('M8\n');
    expect(useLaserStore.getState().streamer).not.toBeNull();
  });

  it('cancels arming when a reboot banner invalidates volatile setup', async () => {
    const writes: string[] = [];
    await connectWith(makeConnection(writes, 'reboot'));
    writes.length = 0;

    await expect(
      useLaserStore.getState().startJob(CNC_MULTI_TOOL, {
        machineKind: 'cnc',
        cncSetupAttestation: currentCncSetupAttestation(CNC_MULTI_TOOL),
      }),
    ).rejects.toThrow(/controller rebooted/i);

    expect(writes).toEqual(['G4 P0.01\n']);
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    expect(useLaserStore.getState().streamer).toBeNull();
  });

  it('requires a positive ok from the queued Start fence', async () => {
    const writes: string[] = [];
    await connectWith(makeConnection(writes, 'fence-error'));
    writes.length = 0;

    await expect(
      useLaserStore.getState().startJob(CNC_MULTI_TOOL, {
        machineKind: 'cnc',
        cncSetupAttestation: currentCncSetupAttestation(CNC_MULTI_TOOL),
      }),
    ).rejects.toThrow(/error:20/i);

    expect(writes).toEqual(['G4 P0.01\n']);
    expect(useLaserStore.getState().streamer).toBeNull();
  });

  it('waits for a pre-reservation transport write before installing the fence', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes, 'transport-backpressure');
    await connectWith(connection);
    writes.length = 0;

    const priorCommand = useLaserStore.getState().sendConsoleCommand('$G');
    expect(useLaserStore.getState().pendingTransportWrites).toBe(1);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    const starting = useLaserStore.getState().startJob(CNC_MULTI_TOOL, {
      machineKind: 'cnc',
      cncSetupAttestation: currentCncSetupAttestation(CNC_MULTI_TOOL),
    });
    await flush();
    expect(writes).toEqual(['$G\n']);

    connection.releaseBlockedWrite();
    await priorCommand;
    expect(useLaserStore.getState().pendingTransportWrites).toBe(0);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    connection.emitLine('ok');
    await starting;

    expect(writes).toContain('G4 P0.01\n');
    expect(useLaserStore.getState().streamer).not.toBeNull();
  });

  it('refuses a direct CNC stream without exact-program setup confirmation', async () => {
    const writes: string[] = [];
    await connectWith(makeConnection(writes));
    writes.length = 0;

    await expect(
      useLaserStore.getState().startJob(CNC_MULTI_TOOL, { machineKind: 'cnc' }),
    ).rejects.toThrow(CNC_SETUP_ATTESTATION_REQUIRED_MESSAGE);

    expect(writes).toEqual([]);
    expect(useLaserStore.getState().streamer).toBeNull();
  });

  it('refuses an exclusive-access confirmation from an older controller/setup epoch', async () => {
    const writes: string[] = [];
    await connectWith(makeConnection(writes));
    writes.length = 0;
    const staleAttestation = currentCncSetupAttestation(CNC_MULTI_TOOL);
    useLaserStore.setState((state) => ({
      workZReferenceEpoch: state.workZReferenceEpoch + 1,
    }));

    await expect(
      useLaserStore.getState().startJob(CNC_MULTI_TOOL, {
        machineKind: 'cnc',
        cncSetupAttestation: staleAttestation,
      }),
    ).rejects.toThrow(CNC_SETUP_ATTESTATION_REQUIRED_MESSAGE);

    expect(writes).toEqual([]);
    expect(useLaserStore.getState().streamer).toBeNull();
  });

  it('refuses a structured tool plan that cannot align with every M0 boundary', async () => {
    const writes: string[] = [];
    await connectWith(makeConnection(writes));

    await expect(
      useLaserStore.getState().startJob(CNC_MULTI_TOOL, {
        machineKind: 'cnc',
        cncToolPlan: CNC_TOOL_PLAN.slice(0, 1),
        cncSetupAttestation: currentCncSetupAttestation(CNC_MULTI_TOOL),
      }),
    ).rejects.toThrow(TOOL_CHANGE_PLAN_MISMATCH_MESSAGE);
    expect(useLaserStore.getState().streamer).toBeNull();
  });

  it('holds a CNC job at the M0 without sending it, then continueToolChange resumes', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectWith(connection);

    writes.length = 0;
    // Simulate valid Z evidence for the first tool. Entering even a synchronous
    // first hold must invalidate it for the replacement tool.
    useLaserStore.setState({
      workZZeroEvidence: {
        source: 'manual-zero',
        referenceEpoch: useLaserStore.getState().workZReferenceEpoch,
        toolId: 'em-3175',
      },
    });
    await useLaserStore.getState().startJob(CNC_MULTI_TOOL, {
      machineKind: 'cnc',
      cncToolPlan: CNC_TOOL_PLAN,
      cncSetupAttestation: currentCncSetupAttestation(CNC_MULTI_TOOL),
    });

    // The pre-M0 lines went out; the M0 did NOT, and the stream is held.
    expect(useLaserStore.getState().streamer?.status).toBe('tool-change');
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    expect(writes.join('')).toContain('G0 X0 Y0');
    expect(writes.join('')).not.toContain('M0');

    // Continue is refused until the pre-M0 retract drains to a FRESH Idle — the
    // resumed spindle/cutting must not queue behind still-moving motion, and the
    // machine must have actually reached the tool-change position (Codex audit P1).
    writes.length = 0;
    await useLaserStore.getState().continueToolChange();
    expect(writes.join('')).toBe('');
    expect(useLaserStore.getState().streamer?.status).toBe('tool-change');

    // Drain the tail with acks, then observe a fresh Idle → the hold is ready.
    while ((useLaserStore.getState().streamer?.inFlight.length ?? 0) > 0) {
      connection.emitLine('ok');
      await flush();
    }
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();

    // Fresh Idle unlocks setup, but Continue still refuses until the new tool
    // has been zeroed. Tool-change entry invalidated the old tool's Z evidence.
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    writes.length = 0;
    await useLaserStore.getState().continueToolChange();
    expect(writes.join('')).toBe('');
    expect(useLaserStore.getState().lastWriteError).toBe(TOOL_CHANGE_Z_ZERO_REQUIRED_MESSAGE);

    // A current Z0 for the old cutter still fails closed: the evidence must be
    // bound to the exact planned replacement tool.
    useLaserStore.setState({
      workZZeroEvidence: {
        source: 'manual-zero',
        referenceEpoch: useLaserStore.getState().workZReferenceEpoch,
        toolId: 'em-3175',
      },
    });
    await useLaserStore.getState().continueToolChange();
    expect(writes.join('')).toBe('');
    expect(useLaserStore.getState().lastWriteError).toContain('different bit');
    expect(useLaserStore.getState().lastWriteError).toContain('6.35 mm end mill');

    // A successful probe for the planned cutter still cannot Continue while
    // the conductive plate/lead remains in the work envelope.
    useLaserStore.setState({
      workZZeroEvidence: {
        source: 'probe',
        referenceEpoch: useLaserStore.getState().workZReferenceEpoch,
        toolId: 'em-6350',
        probePlateRemoved: false,
      },
    });
    await useLaserStore.getState().continueToolChange();
    expect(writes.join('')).toBe('');
    expect(useLaserStore.getState().lastWriteError).toBe(PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE);

    // After explicit removal confirmation, the first resumed command is the
    // spindle-off safe-Z lift; M3 follows it.
    useLaserStore.getState().confirmProbePlateRemoved();
    await useLaserStore.getState().continueToolChange();
    const resumed = writes.join('');
    expect(resumed).toContain('G0 Z5');
    expect(resumed).toContain('M3 S12000');
    expect(resumed.indexOf('G0 Z5')).toBeLessThan(resumed.indexOf('M3 S12000'));
    expect(useLaserStore.getState().streamer?.status).not.toBe('tool-change');
  });

  it('names the bit at the tool-change hold from the compiled label (R5)', async () => {
    const writes: string[] = [];
    await connectWith(makeConnection(writes));
    await useLaserStore.getState().startJob(CNC_MULTI_TOOL, {
      machineKind: 'cnc',
      cncToolPlan: CNC_TOOL_PLAN,
      cncSetupAttestation: currentCncSetupAttestation(CNC_MULTI_TOOL),
    });

    expect(useLaserStore.getState().streamer?.status).toBe('tool-change');
    // The generic "the next bit" prompt is replaced by the real bit identity.
    expect(useLaserStore.getState().pendingToolLabel).toBe('6.35 mm end mill');
    expect(useLaserStore.getState().pendingToolId).toBe('em-6350');
  });

  it('leaves the tool label null for a laser job M0 (no CNC tool change) (R5)', async () => {
    const writes: string[] = [];
    await connectWith(makeConnection(writes));
    await useLaserStore
      .getState()
      .startJob(`${TOOL_CHANGE_LOAD_PREFIX}ignored\nG1 X1 S100\nM0`, { machineKind: 'laser' });
    expect(useLaserStore.getState().pendingToolLabel).toBeNull();
  });

  it('streams a laser job M0 through as an ordinary program stop', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectWith(connection);

    writes.length = 0;
    await useLaserStore.getState().startJob('G1 X1 Y1 S100\nM0\nG1 X2 Y2 S100\n', {
      machineKind: 'laser',
    });

    expect(useLaserStore.getState().streamer?.status).not.toBe('tool-change');
    expect(writes.join('')).toContain('M0');
  });
});
