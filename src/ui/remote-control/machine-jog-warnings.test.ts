// Rolling audit v4 H8-P2-2, secondary point (ADR-585 Amendment 3): a phone jog's
// receipt carries the jog bounds and no-go warnings the PC showed for it, word for
// word. They stay warnings (ADR-232): the jog is sent and the receipt is `completed`.
// Each case drives the real remote jog_machine / jog_hold_start through the real
// GRBL store on a fake serial line, then the PC's own jog with the same vector on
// the same reported position, and compares the texts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, type Project } from '../../core/scene';
import { DEFAULT_DEVICE_PROFILE, type NoGoZone } from '../../core/devices';
import type { JogParams } from '../../core/controllers/grbl';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from '../state/laser-store';
import {
  respondToTestGrblHandshake,
  settleTestGrblHandshake,
} from '../state/laser-test-start-helpers';
import { useStore } from '../state/store';
import { useToastStore } from '../state/toast-store';
import { executeMachineOperation, type MachineExecutionContext } from './machine-execution';
import { operationIsTerminal, type OwnedMachineOperation } from './machine-operation-state';
import { machineOperationProjection } from './machine-projections';
import type { MachineCommand } from './machine-types';
import type { RemoteControlOptions } from './types';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

const ZONE: NoGoZone = {
  id: 'clamp',
  name: 'Left clamp',
  enabled: true,
  x: 25,
  y: 40,
  width: 10,
  height: 20,
};

let connection: FakeConnection;
let position = { x: 0, y: 0 };

function makeConnection(): FakeConnection {
  const handlers = new Set<(line: string) => void>();
  const emitLine = (line: string): void => {
    for (const handler of handlers) handler(line);
  };
  return {
    write: async (data) => respondToTestGrblHandshake(data, emitLine),
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine,
  };
}

function adapter(serial: SerialConnection): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: { isSupported: () => true, requestPort: async () => ({ open: async () => serial }) },
  } as unknown as PlatformAdapter;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};
const idle = (): void =>
  connection.emitLine(`<Idle|MPos:${position.x.toFixed(3)},${position.y.toFixed(3)},0.000|FS:0,0>`);

async function connectIdleAt(x: number, y: number): Promise<void> {
  position = { x, y };
  connection = makeConnection();
  await useLaserStore.getState().connect(adapter(connection));
  connection.emitLine('Grbl 1.1f');
  idle();
  await flush();
  connection.emitLine('ok');
  idle();
  await settleTestGrblHandshake();
}

/** Acknowledge the jog and its settle line, and report Idle, until `done` holds. */
async function settle(done: () => boolean): Promise<void> {
  for (let i = 0; i < 40 && !done(); i += 1) {
    connection.emitLine('ok');
    idle();
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function operation(kind: 'jog' | 'hold'): OwnedMachineOperation {
  return {
    authority: {},
    controller: new AbortController(),
    documentEpoch: useStore.getState().projectDocumentEpoch,
    controllerEpoch: useLaserStore.getState().controllerSessionEpoch,
    kind,
    state: 'running',
    committed: false,
    cleanup: () => undefined,
  } as unknown as OwnedMachineOperation;
}

// No artwork sharing: the receipt must still reach the phone whole.
const options = {} as RemoteControlOptions;
const context: MachineExecutionContext = {
  options,
  revision: () => 'r1',
  assertOwned: () => undefined,
};

/** The real remote command; returns its operation and the jog vector it sent. */
async function remote(
  input: MachineCommand,
  kind: 'jog' | 'hold',
): Promise<{ readonly owned: OwnedMachineOperation; readonly sent: JogParams }> {
  const real = useLaserStore.getState().jog;
  const sent: JogParams[] = [];
  useLaserStore.setState({
    jog: (params, owner, options) => {
      sent.push(params);
      return real(params, owner, options);
    },
  });
  const owned = operation(kind);
  idle();
  const run = executeMachineOperation(
    input as Parameters<typeof executeMachineOperation>[0],
    owned,
    context,
  );
  await settle(() => operationIsTerminal(owned));
  await run;
  useLaserStore.setState({ jog: real });
  const vector = sent[0];
  if (vector === undefined) throw new Error('the remote command sent no jog');
  return { owned, sent: vector };
}

/** The PC's own jog of the same vector on the same position; returns the toasts it showed. */
async function pcJog(vector: JogParams): Promise<readonly string[]> {
  useToastStore.setState({ toasts: [] });
  idle();
  await flush();
  const done = useLaserStore.getState().jog(vector);
  let finished = false;
  void done.finally(() => (finished = true));
  await settle(() => finished && useLaserStore.getState().motionOperation === null);
  await done;
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

function withZone(project: Project): Project {
  return {
    ...project,
    device: { ...project.device, bedWidth: 400, bedHeight: 300, noGoZones: [ZONE] },
  };
}

const jogX = (distanceMm: number): MachineCommand =>
  ({
    command: 'jog_machine',
    args: { axis: 'x', direction: 1, distanceMm, requestId: 'q1', expectedRevision: 'r1' },
  }) as unknown as MachineCommand;
const holdX = {
  command: 'jog_hold_start',
  args: { axis: 'x', direction: 1, requestId: 'q2', expectedRevision: 'r1' },
} as unknown as MachineCommand;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  useStore.setState((state) => ({ project: withZone(state.project) }));
  useLaserStore.setState({
    capabilities: { ...useLaserStore.getState().capabilities, jogCancel: true },
  });
  useToastStore.setState({ toasts: [] });
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useStore.setState({ project: createProject(DEFAULT_DEVICE_PROFILE) });
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    lastWriteError: null,
    motionOperation: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  vi.restoreAllMocks();
});

describe('a remote jog receipt carries the PC jog warnings (ADR-585 Amendment 3)', () => {
  it('jog_machine: the bounds and no-go texts, word for word, and the jog still completes', async () => {
    // From (392, 50), +X 10 mm ends at 402 (past the 400 mm bed) and crosses a zone at 395..399.
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: { ...state.project.device, noGoZones: [{ ...ZONE, x: 395, width: 4 }] },
      },
    }));
    await connectIdleAt(392, 50);
    const { owned, sent } = await remote(jogX(10), 'jog');
    // The PC operator saw the remote jog's warnings too.
    const shownForRemote = useToastStore.getState().toasts.map((toast) => toast.message);
    const pc = await pcJog(sent);

    expect(shownForRemote).toEqual(pc);
    // The PC says a jog's findings in one toast slot, bounds first (ADR-708).
    expect(pc).toHaveLength(1);
    expect(pc[0]).toMatch(
      /outside the configured machine bounds.* crosses the configured no-go zone "Left clamp"/,
    );
    expect(owned.state).toBe('completed');
    expect(owned.committed).toBe(true);
    expect(owned.message).toBe(pc.join(' '));
    // The phone sees the whole text, not the artwork-filter fallback.
    expect(machineOperationProjection('o1', owned, 'r1', options).message).toBe(pc.join(' '));
  });

  it('jog_machine: a clean jog keeps a bare completed receipt', async () => {
    await connectIdleAt(100, 100);
    const { owned, sent } = await remote(jogX(10), 'jog');
    expect(await pcJog(sent)).toEqual([]);
    expect(owned.state).toBe('completed');
    expect(owned.message).toBeUndefined();
    expect(owned.policyMessage).toBeUndefined();
  });

  it('jog_hold_start: the hold outcome followed by the no-go text the PC shows', async () => {
    // From (20, 50) the hold aims +100 mm and crosses the zone at 25..35.
    await connectIdleAt(20, 50);
    const { owned, sent } = await remote(holdX, 'hold');
    expect(sent.dx).toBe(100);
    const pc = await pcJog(sent);

    expect(pc).toEqual([expect.stringMatching(/no-go zone "Left clamp"/)]);
    expect(owned.state).toBe('completed');
    expect(owned.message).toBe(`Reached the hold travel limit. ${pc[0]}`);
    expect(machineOperationProjection('o2', owned, 'r1', options).message).toBe(owned.message);
  });
});
