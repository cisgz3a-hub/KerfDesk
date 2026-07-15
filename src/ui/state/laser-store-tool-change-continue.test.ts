// F22: continuing a tool-change hold whose next section fits the RX buffer lands
// directly in the following hold within a single fill. The ack-path transition
// patch never sees it, so runContinueToolChange must apply the hold-entry patch
// itself. Split from laser-store-tool-change.test.ts to stay under the size cap;
// a trimmed local serial harness keeps this file self-contained.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { createProject } from '../../core/scene';
import { TOOL_CHANGE_LOAD_PREFIX } from '../../core/output';
import {
  cncControllerEpochOf,
  createCncSetupAttestation,
  type CncSetupAttestation,
} from './cnc-setup-attestation';
import { useStore } from './store';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

const IDLE = '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>';

function makeConnection(writes: string[]): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const connection: FakeConnection = {
    write: async (data) => {
      writes.push(data);
      if (data === 'G4 P0.01\n') setTimeout(() => connection.emitLine('ok'), 0);
      if (data === '?') setTimeout(() => connection.emitLine(IDLE), 0);
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
  connection.emitLine(IDLE);
  await flush();
  connection.emitLine('ok');
  connection.emitLine(IDLE);
  await flush();
}

function currentCncSetupAttestation(gcode: string): CncSetupAttestation {
  return createCncSetupAttestation(gcode, cncControllerEpochOf(useLaserStore.getState()));
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
    const connection = makeConnection(writes);
    await connectWith(connection);
    writes.length = 0;

    await useLaserStore.getState().startJob(CNC_THREE_TOOL, {
      machineKind: 'cnc',
      cncToolPlan: CNC_THREE_PLAN,
      cncSetupAttestation: currentCncSetupAttestation(CNC_THREE_TOOL),
    });
    // Hold 1 — the pending bit is tool 2.
    expect(useLaserStore.getState().streamer?.status).toBe('tool-change');
    expect(useLaserStore.getState().pendingToolId).toBe('em-6350');

    // Drain hold 1's pre-M0 tail and observe a fresh Idle, then touch off tool 2.
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
        toolId: 'em-6350',
      },
    });

    // The whole tool-2 section fits the buffer, so this single fill resumes and
    // lands straight in hold 2.
    writes.length = 0;
    await useLaserStore.getState().continueToolChange();
    expect(useLaserStore.getState().streamer?.status).toBe('tool-change');
    expect(writes.join('')).toContain('M3 S12000');
    expect(writes.join('')).not.toContain('M3 S9000'); // tool-3 section not sent

    // Entering the next hold must void tool 2's Z evidence and re-point the
    // pending label/id at tool 3 — so Continue cannot proceed on the wrong bit.
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    expect(useLaserStore.getState().pendingToolId).toBe('em-3000');
    expect(useLaserStore.getState().pendingToolLabel).toBe('3.0 mm end mill');
    expect(useLaserStore.getState().toolChangeIdleSeen).toBe(false);
  });
});
