import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { editShortcutContext } from '../app/shortcut-contexts';
import { handleEditShortcut } from '../app/shortcuts';
import { cncWorkZeroToolStartIssue } from '../laser/cnc-start-advisories';
import { useLaserStore } from './laser-store';
import { respondToTestGrblHandshake } from './laser-test-start-helpers';
import { useStore } from './store';
import { isWorkZZeroEvidenceCurrent } from './work-z-zero-evidence';

const INITIAL_TOOL = 'em-3175';
const OTHER_TOOL = 'em-6350';
const IDLE = '<Idle|MPos:0.000,0.000,0.000|FS:0,0>';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

function makeConnection(write: (data: string) => Promise<void>): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const emitLine = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      if (useLaserStore.getState().controllerOperation?.kind === 'connection-handshake') {
        respondToTestGrblHandshake(data, emitLine);
        return;
      }
      await write(data);
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine,
  };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

function selectedToolId(): string {
  const machine = useStore.getState().project.machine;
  if (machine?.kind !== 'cnc') throw new Error('Expected a CNC project');
  return machine.toolId;
}

async function connect(): Promise<{
  connection: FakeConnection;
  write: ReturnType<typeof vi.fn<(data: string) => Promise<void>>>;
}> {
  useStore.setState({
    project: {
      ...createProject(),
      machine: { ...DEFAULT_CNC_MACHINE_CONFIG, toolId: OTHER_TOOL },
    },
    undoStack: [],
    redoStack: [],
  });
  useStore.getState().updateCncMachine({ toolId: INITIAL_TOOL });
  const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
  const connection = makeConnection(write);
  const adapter: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({ open: async () => connection }),
    },
  };
  await useLaserStore.getState().connect(adapter);
  connection.emitLine('Grbl 1.1f');
  connection.emitLine(IDLE);
  await flush();
  connection.emitLine('ok');
  connection.emitLine(IDLE);
  await flush();
  write.mockClear();
  return { connection, write };
}

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    controllerOperation: null,
    workZZeroEvidence: null,
    streamer: null,
    safetyNotice: null,
    lastWriteError: null,
  });
  useStore.setState({ project: createProject(), undoStack: [], redoStack: [] });
  vi.restoreAllMocks();
});

describe('Zero Z evidence ownership', () => {
  it.each(['unchanged', 'edit', 'undo'] as const)(
    'acknowledges the initiating tool after an intervening %s',
    async (change) => {
      const { connection, write } = await connect();
      const referenceEpoch = useLaserStore.getState().workZReferenceEpoch;
      const originVersion = useLaserStore.getState().workOriginVersion;
      const action = useLaserStore.getState().zeroZHere();
      await flush();
      expect(write).toHaveBeenCalledWith('G54 G92 Z0\n');
      expect(useLaserStore.getState().workZZeroEvidence).toBeNull();

      if (change === 'edit') useStore.getState().updateCncMachine({ toolId: OTHER_TOOL });
      if (change === 'undo') {
        expect(
          handleEditShortcut(
            new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }),
            editShortcutContext(),
          ),
        ).toBe(true);
      }
      const selectedTool = change === 'unchanged' ? INITIAL_TOOL : OTHER_TOOL;
      expect(selectedToolId()).toBe(selectedTool);
      connection.emitLine('ok');
      await action;

      const { workZZeroEvidence: evidence } = useLaserStore.getState();
      expect(evidence).toEqual({
        source: 'manual-zero',
        referenceEpoch,
        toolId: INITIAL_TOOL,
      });
      expect(selectedToolId()).toBe(selectedTool);
      expect(useLaserStore.getState().workOriginVersion).toBe(originVersion);
      expect(useLaserStore.getState().controllerOperation).toBeNull();
      const advisory = cncWorkZeroToolStartIssue(useStore.getState().project, evidence, {
        id: selectedTool,
        name: selectedTool,
      });
      if (change === 'unchanged') expect(advisory).toBeNull();
      else expect(advisory).toContain('work Z was established for');
    },
  );

  it('retains the initiating tool while waiting for fresh Idle before the write', async () => {
    const { connection, write } = await connect();
    useLaserStore.setState({ statusObservation: null });
    const action = useLaserStore.getState().zeroZHere();
    await flush();
    expect(write).toHaveBeenCalledWith('?');
    expect(write).not.toHaveBeenCalledWith('G54 G92 Z0\n');
    useStore.getState().updateCncMachine({ toolId: OTHER_TOOL });
    connection.emitLine(IDLE);
    await flush();
    expect(write).toHaveBeenCalledWith('G54 G92 Z0\n');
    connection.emitLine('ok');
    await action;

    expect(useLaserStore.getState().workZZeroEvidence?.toolId).toBe(INITIAL_TOOL);
    expect(selectedToolId()).toBe(OTHER_TOOL);
  });

  it('does not certify a reference epoch that changed while acknowledgement was pending', async () => {
    const { connection } = await connect();
    const referenceEpoch = useLaserStore.getState().workZReferenceEpoch;
    const action = useLaserStore.getState().zeroZHere();
    await flush();
    useLaserStore.setState({ workZReferenceEpoch: referenceEpoch + 1 });
    connection.emitLine('ok');
    await action;

    const state = useLaserStore.getState();
    expect(state.workZZeroEvidence?.referenceEpoch).toBe(referenceEpoch);
    expect(isWorkZZeroEvidenceCurrent(state.workZZeroEvidence, state.workZReferenceEpoch)).toBe(
      false,
    );
  });

  it('does not restore evidence when the controller session ends before acknowledgement', async () => {
    const { connection } = await connect();
    const action = useLaserStore.getState().zeroZHere();
    const rejection = expect(action).rejects.toThrow();
    await flush();
    await useLaserStore.getState().disconnect();
    connection.emitLine('ok');
    await rejection;

    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });
});
