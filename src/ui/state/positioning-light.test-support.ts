import { vi } from 'vitest';
import { selectControllerDriver } from '../../core/controllers';
import type { ControllerCommandSet, ControllerKind } from '../../core/devices/device-profile';
import { parseStatusReport } from '../../core/controllers/grbl';
import { initialLaserState } from './laser-store-helpers';
import {
  consumeControllerCommandResponse,
  cancelControllerLifecycleRefs,
} from './laser-interactive-command';
import { observeFreshControllerStatus } from './laser-controller-status-wait';
import { positioningLightActions } from './positioning-light-actions';
import { useLaserStore, type LaserState, type LiveRefs } from './laser-store';
import { useStore } from './store';
import type { SafeWrite } from './laser-safe-write';

export const originalProject = useStore.getState().project;

export function harness(kind: ControllerKind = 'grbl-v1.1', commandSet?: ControllerCommandSet) {
  const { driver, mapping, refs, state: initial } = initialHarness(kind, commandSet);
  let state = initial;
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
    );
    if (report === null) throw new Error('Fixture status was not valid');
    state = { ...state, statusReport: report, statusSequence: state.statusSequence + 1 };
    consumeControllerCommandResponse(refs, { kind: 'status', report }, 'status');
    observeFreshControllerStatus(
      refs,
      { sessionEpoch: state.controllerSessionEpoch, sequence: state.statusSequence },
      report,
    );
  };
  const ack = (line: string): void => acknowledge(refs, driver, line);
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

function initialHarness(kind: ControllerKind, commandSet?: ControllerCommandSet) {
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
  const state: LaserState = {
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
  return { driver, mapping, state, refs };
}

function acknowledge(refs: LiveRefs, driver: LiveRefs['driver'], line: string): void {
  const response = line === 'fire off' ? 'turning laser off and returning to auto mode' : 'ok';
  consumeControllerCommandResponse(refs, driver.classifyLine(response), response);
}
