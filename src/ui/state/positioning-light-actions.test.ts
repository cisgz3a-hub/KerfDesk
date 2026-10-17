import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectControllerDriver } from '../../core/controllers';
import type { ControllerCommandSet, ControllerKind } from '../../core/devices/device-profile';
import { parseStatusReport } from '../../core/controllers/grbl';
import { initialLaserState, disconnectStopCommands } from './laser-store-helpers';
import {
  consumeControllerCommandResponse,
  cancelControllerLifecycleRefs,
} from './laser-interactive-command';
import { observeFreshControllerStatus } from './laser-controller-status-wait';
import { positioningLightActions } from './positioning-light-actions';
import { useLaserStore, type LaserState, type LiveRefs } from './laser-store';
import { useStore } from './store';
import type { SafeWrite } from './laser-safe-write';

const originalProject = useStore.getState().project;
afterEach(() => {
  useStore.setState({ project: originalProject });
  vi.useRealTimers();
});

function harness(kind: ControllerKind = 'grbl-v1.1', commandSet?: ControllerCommandSet) {
  const driver = selectControllerDriver(kind, commandSet);
  const mapping =
    kind === 'marlin'
      ? { onCommand: 'M355 S1 P255', offCommand: 'M355 S0', offsetXmm: 0, offsetYmm: 0 }
      : { onCommand: 'M64 P0', offCommand: 'M65 P0', offsetXmm: 0, offsetYmm: 0 };
  useStore.setState({
    project: {
      ...originalProject,
      machine: { kind: 'laser' },
      device: { ...originalProject.device, controllerKind: kind, positioningLight: mapping },
    },
  });
  let state: LaserState = {
    ...useLaserStore.getState(),
    ...initialLaserState(),
    connection: { kind: 'connected' },
    activeControllerKind: kind,
    capabilities: driver.capabilities,
    statusReport: parseStatusReport('<Idle|MPos:0,0,0|WCO:0,0,0>'),
    controllerSessionEpoch: 3,
  };
  const refs = {
    driver,
    connection: {},
    writeEpoch: 1,
    controllerCommand: null,
    controllerIdleWait: null,
    controllerStatusWait: null,
  } as unknown as LiveRefs;
  const writes: string[] = [];
  let head = { x: 0, y: 0 };
  let movingPolls = 0;
  let moved = false;
  let holdLine: string | undefined;
  let failLine: string | undefined;
  let afterWrite: ((line: string) => void) | undefined;
  const set = (patch: Partial<LaserState> | ((state: LaserState) => Partial<LaserState>)): void => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  };
  const emitStatus = (): void => {
    const motionState = movingPolls-- > 0 ? 'Jog' : 'Idle';
    const report = parseStatusReport(
      `<${motionState}|MPos:${kind === 'marlin' ? head.x.toFixed(2) : head.x},${kind === 'marlin' ? head.y.toFixed(2) : head.y},0|WCO:0,0,0>`,
    )!;
    state = { ...state, statusReport: report, statusSequence: state.statusSequence + 1 };
    consumeControllerCommandResponse(refs, { kind: 'status', report }, 'status');
    observeFreshControllerStatus(
      refs,
      { sessionEpoch: state.controllerSessionEpoch, sequence: state.statusSequence },
      report,
    );
  };
  const ack = (line: string): void => {
    const response = line === 'fire off' ? 'turning laser off and returning to auto mode' : 'ok';
    consumeControllerCommandResponse(refs, driver.classifyLine(response), response);
  };
  const acceptMotion = (line: string): void => {
    if (line.startsWith('$J=') || line.startsWith('G0 ') || line.startsWith('G1 ')) {
      head = {
        x: head.x + Number(/X(-?[\d.]+)/.exec(line)?.[1] ?? 0),
        y: head.y + Number(/Y(-?[\d.]+)/.exec(line)?.[1] ?? 0),
      };
      moved = true;
    }
  };
  const write: SafeWrite = async (wire, _action, _source, assertCurrent) => {
    assertCurrent?.();
    writes.push(wire);
    const line = wire.trim();
    afterWrite?.(line);
    if (line === failLine) throw new Error('wire handoff failed');
    if (line === holdLine) return;
    if (line === '?' || line === 'M114') emitStatus();
    acceptMotion(line);
    if (line !== '?') ack(line);
  };
  const stop = vi.fn(async () => {
    cancelControllerLifecycleRefs(refs);
    set({ controllerOperation: null });
  });
  set({ stopJob: stop });
  const actions = positioningLightActions(set, () => state, refs, write);
  return {
    actions,
    writes,
    refs,
    mapping,
    stop,
    get: () => state,
    set,
    ack,
    hold: (line?: string) => {
      holdLine = line;
    },
    fail: (line: string) => {
      failLine = line;
    },
    after: (fn: (line: string) => void) => {
      afterWrite = fn;
    },
    moving: (count: number) => {
      movingPolls = count;
    },
    hasMoved: () => moved,
  };
}

const families: ControllerKind[] = ['grbl-v1.1', 'grblhal', 'fluidnc', 'marlin', 'smoothieware'];
describe('separate positioning light transaction', () => {
  it.each(families)(
    'owns beam-off travel, planner settlement, fresh position and light ACK on %s',
    async (kind) => {
      const h = harness(kind);
      await h.actions.centrePositioningLight(40.004, 45.006, 1200);
      const lines = h.writes.map((line) => line.trim());
      const move = lines.findIndex(
        (line) => line.startsWith('$J=') || line.startsWith('G0 ') || line.startsWith('G1 '),
      );
      expect(move).toBeGreaterThan(lines.indexOf(h.refs.driver.commands.frameToolOffLines[0]!));
      const on = lines.indexOf(h.mapping.onCommand);
      expect(on).toBeGreaterThan(move);
      expect(lines.slice(move + 1, on)).toContain(h.refs.driver.commands.settleDwell);
      expect(lines[on - 1]).toBe(kind === 'marlin' ? 'M114' : '?');
      expect(h.get().controllerOperation).toBeNull();
      expect(h.get().positioningLightEnabled).toBe(true);
      await h.actions.setPositioningLightEnabled(false);
      expect(h.get().positioningLightEnabled).toBe(false);
      expect(h.writes.at(-1)?.trim()).toBe(h.mapping.offCommand);
    },
  );

  it('uses the Falcon beam-off G1 command contract without native jog bytes', async () => {
    const h = harness('grbl-v1.1', 'creality-falcon-a1-pro');
    await h.actions.centrePositioningLight(40, 45, 1200);
    expect(h.writes).toContain('G1 X40.000 Y45.000 F1200 S0\n');
    expect(h.writes.some((line) => line.startsWith('$J='))).toBe(false);
    expect(h.get().positioningLightEnabled).toBe(true);
  });

  it('waits out native Jog before sending its ordinary G4 fence', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.after((line) => {
      if (line.startsWith('$J=')) h.moving(3);
    });
    const pending = h.actions.centrePositioningLight(40, 45, 1200);
    await vi.advanceTimersByTimeAsync(150);
    expect(h.hasMoved()).toBe(true);
    expect(h.writes.filter((line) => line.startsWith('G4'))).toHaveLength(1);
    expect(h.writes).not.toContain(`${h.mapping.onCommand}\n`);
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(h.writes.filter((line) => line.startsWith('G4'))).toHaveLength(2);
  });

  it('requires final marker acknowledgement despite fresh Idle', async () => {
    const h = harness();
    let markers = 0;
    h.after((line) => {
      if (line.startsWith('G4') && ++markers === 2) h.hold(line);
    });
    const pending = h.actions.centrePositioningLight(40, 45, 1200);
    await vi.waitFor(() => expect(markers).toBe(2));
    expect(h.writes).not.toContain(`${h.mapping.onCommand}\n`);
    h.hold();
    h.ack(h.refs.driver.commands.settleDwell);
    await pending;
  });

  it('keeps Off available after an uncertain on handoff and uses its captured mapping after profile changes', async () => {
    const h = harness();
    h.fail(h.mapping.onCommand);
    await expect(h.actions.centrePositioningLight(40, 45, 1200)).rejects.toThrow('handoff');
    expect(h.get().positioningLightEnabled).toBe(true);
    useStore.setState({
      project: { ...useStore.getState().project, device: { ...originalProject.device } },
    });
    await h.actions.setPositioningLightEnabled(false);
    expect(h.writes.at(-1)?.trim()).toBe(h.mapping.offCommand);
    expect(h.get().positioningLightEnabled).toBe(false);
  });

  it('contains an uncertain motion even while the last cached report still says Idle', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.after((line) => {
      if (line.startsWith('$J=')) h.hold(line);
    });
    const pending = h.actions.centrePositioningLight(40, 45, 1200);
    const failure = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(9000);
    await failure;
    expect(h.stop).toHaveBeenCalledOnce();
    expect(h.writes).not.toContain(`${h.mapping.onCommand}\n`);
  });

  it('never continues into a replacement session after a pending acknowledgement', async () => {
    const h = harness();
    h.hold('M5');
    const pending = h.actions.centrePositioningLight(40, 45, 1200);
    const failure = expect(pending).rejects.toThrow(/session changed/);
    await vi.waitFor(() => expect(h.writes).toContain('M5\n'));
    h.refs.connection = {} as LiveRefs['connection'];
    h.ack('M5');
    await failure;
    expect(h.hasMoved()).toBe(false);
    expect(h.writes).not.toContain(`${h.mapping.onCommand}\n`);
  });

  it('preserves a replacement controller operation when failure cleanup finishes', async () => {
    const h = harness('marlin');
    const replacement = {
      kind: 'interactive-command' as const,
      phase: 'command' as const,
      label: 'New controller operation',
    };
    h.fail('G0 X40.000 Y45.000 F1200');
    h.set({
      stopJob: async () => {
        h.set({ controllerOperation: replacement });
      },
    });
    await expect(h.actions.centrePositioningLight(40, 45, 1200)).rejects.toThrow('handoff');
    expect(h.get().controllerOperation).toBe(replacement);
  });

  it('reserves motion ownership for Disconnect before any travel', async () => {
    const h = harness();
    h.hold('M5');
    const pending = h.actions.centrePositioningLight(40, 45, 1200);
    const failure = expect(pending).rejects.toThrow(/cancelled/);
    await vi.waitFor(() => expect(h.writes).toContain('M5\n'));
    expect(disconnectStopCommands(h.get(), h.refs.driver)).toContain('\x18');
    cancelControllerLifecycleRefs(h.refs);
    await failure;
  });

  it('cancels a timed-out queued Marlin query before releasing the operation', async () => {
    vi.useFakeTimers();
    const h = harness('marlin');
    h.hold('M114');
    const pending = h.actions.centrePositioningLight(40, 45, 1200);
    const failure = expect(pending).rejects.toThrow(/position|handoff/);
    await vi.advanceTimersByTimeAsync(3100);
    await failure;
    expect(h.refs.controllerCommand).toBeNull();
    expect(h.get().controllerOperation).toBeNull();
    expect(h.hasMoved()).toBe(false);
  });

  it('rejects an Off fallback from a different profile family without writing', async () => {
    const h = harness();
    useStore.getState().updateDeviceProfile({
      controllerKind: 'marlin',
      positioningLight: { ...h.mapping, offCommand: 'M355 S0' },
    });
    await expect(h.actions.setPositioningLightEnabled(false)).rejects.toThrow('does not match');
    expect(h.writes).toEqual([]);
  });

  it('turns off the captured light even after a different controller profile is selected', async () => {
    const h = harness();
    await h.actions.centrePositioningLight(40, 45, 1200);
    useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
    await h.actions.setPositioningLightEnabled(false);
    expect(h.writes.at(-1)?.trim()).toBe(h.mapping.offCommand);
  });

  it.each([
    ['marlin', 'M355 S1', 'M0355 S1'],
    ['fluidnc', 'M64 P0', 'M65 P1'],
    ['marlin', 'M125', 'M355 S0'],
  ] as const)(
    'rejects invalid %s light mapping before any controller write',
    async (kind, onCommand, offCommand) => {
      const h = harness(kind);
      useStore.setState((state) => ({
        project: {
          ...state.project,
          device: {
            ...state.project.device,
            positioningLight: { ...h.mapping, onCommand, offCommand },
          },
        },
      }));
      await expect(h.actions.centrePositioningLight(40, 45, 1200)).rejects.toThrow(
        /Positioning light/,
      );
      expect(h.writes).toEqual([]);
      expect(h.hasMoved()).toBe(false);
      expect(h.get().controllerOperation).toBeNull();
    },
  );

  it('rejects file-only controllers and invalid maps without any command', async () => {
    const h = harness('ruida');
    await expect(h.actions.centrePositioningLight(40, 45, 1200)).rejects.toThrow('file export');
    expect(h.writes).toEqual([]);
    const g = harness();
    useStore.setState({
      project: {
        ...useStore.getState().project,
        device: {
          ...originalProject.device,
          positioningLight: { ...g.mapping, onCommand: 'M3 S1' },
        },
      },
    });
    await expect(g.actions.centrePositioningLight(40, 45, 1200)).rejects.toThrow(/accessory/);
    expect(g.writes).toEqual([]);
  });
});
