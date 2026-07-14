// CNC-01..03 activation — a multi-tool CNC job holds at the M0 (never sent),
// and continueToolChange resumes it. A laser job's M0 streams through. Drives
// the real store over a fake serial port, the same path the app takes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { createProject } from '../../core/scene';
import { TOOL_CHANGE_LOAD_PREFIX } from '../../core/output';
import { TOOL_CHANGE_PLAN_MISMATCH_MESSAGE } from './laser-job-actions';
import { useStore } from './store';
import { useLaserStore } from './laser-store';
import { TOOL_CHANGE_Z_ZERO_REQUIRED_MESSAGE } from './laser-store-helpers';
import { PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE } from './work-z-zero-evidence';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

function makeConnection(writes: string[]): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  return {
    write: async (data) => {
      writes.push(data);
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
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
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
  it('refuses a structured tool plan that cannot align with every M0 boundary', async () => {
    const writes: string[] = [];
    await connectWith(makeConnection(writes));

    await expect(
      useLaserStore.getState().startJob(CNC_MULTI_TOOL, {
        machineKind: 'cnc',
        cncToolPlan: CNC_TOOL_PLAN.slice(0, 1),
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
