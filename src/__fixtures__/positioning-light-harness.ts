import { vi } from 'vitest';
import { selectControllerDriver } from '../core/controllers';
import type { ControllerCommandSet, ControllerKind } from '../core/devices/device-profile';
import { parseStatusReport } from '../core/controllers/grbl';
import { initialLaserState } from '../ui/state/laser-store-helpers';
import {
  consumeControllerCommandResponse,
  cancelControllerLifecycleRefs,
} from '../ui/state/laser-interactive-command';
import { observeFreshControllerStatus } from '../ui/state/laser-controller-status-wait';
import { positioningLightActions } from '../ui/state/positioning-light-actions';
import { useLaserStore, type LaserState, type LiveRefs } from '../ui/state/laser-store';
import { useStore } from '../ui/state/store';
import type { SafeWrite } from '../ui/state/laser-safe-write';

// A scripted controller for the positioning-light transaction tests.
export const originalProject = useStore.getState().project;

export function harness(
  kind: ControllerKind = 'grbl-v1.1',
  commandSet?: ControllerCommandSet,
  reportOptions: { readonly workOnly?: boolean; readonly reportInches?: boolean } = {},
) {
  let workOnly = reportOptions.workOnly === true;
  const formatPosition = (value: number) =>
    reportOptions.reportInches === true
      ? (value / 25.4).toFixed(6)
      : kind === 'marlin'
        ? value.toFixed(2)
        : String(value);
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
    statusReport: parseStatusReport(workOnly ? '<Idle|WPos:0,0,0>' : '<Idle|MPos:0,0,0|WCO:0,0,0>'),
    controllerSettings: { reportInches: reportOptions.reportInches === true },
    ...(workOnly ? { workOriginActive: true, workOriginSource: 'unknown' as const } : {}),
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
  let refuseLine: string | undefined;
  let refusalResponse = 'error:20';
  let afterWrite: ((line: string) => void) | undefined;
  const set = (patch: Partial<LaserState> | ((state: LaserState) => Partial<LaserState>)): void => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  };
  const emitStatus = (): void => {
    const motionState = movingPolls-- > 0 ? 'Jog' : 'Idle';
    const field = workOnly ? 'WPos' : 'MPos';
    const report = parseStatusReport(
      '<' +
        motionState +
        '|' +
        field +
        ':' +
        formatPosition(head.x) +
        ',' +
        formatPosition(head.y) +
        ',0' +
        (workOnly ? '' : '|WCO:0,0,0') +
        '>',
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
    // A realtime override byte is acted on at once and owes no reply.
    if (line.length === 1 && line.charCodeAt(0) >= 0x80) return;
    const response = line === 'fire off' ? 'turning laser off and returning to auto mode' : 'ok';
    consumeControllerCommandResponse(refs, driver.classifyLine(response), response);
  };
  const emitRefusal = (line: string): void => {
    const response = driver.classifyLine(refusalResponse);
    consumeControllerCommandResponse(refs, response, refusalResponse);
    if (
      response.kind === 'unknown-command' ||
      (response.kind === 'error' && response.acknowledgesLine === false)
    )
      ack(line);
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
    // A batched write (a multi-line jog) is answered line by line, as firmware does.
    for (const line of wire.split('\n').map((part) => part.trim())) {
      if (line === '') continue;
      afterWrite?.(line);
      if (line === failLine) throw new Error('wire handoff failed');
      if (line === holdLine) return;
      if (line === refuseLine) {
        emitRefusal(line);
        continue;
      }
      if (line === '?' || line === 'M114') emitStatus();
      acceptMotion(line);
      if (line !== '?') ack(line);
    }
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
    /** Reply with an error or matching unknown-command, including a required trailing ACK. */
    refuse: (line?: string, response = 'error:20') => {
      refuseLine = line;
      refusalResponse = response;
    },
    after: (fn: (line: string) => void) => {
      afterWrite = fn;
    },
    moving: (count: number) => {
      movingPolls = count;
    },
    hasMoved: () => moved,
    reportWorkOnly: (value: boolean) => {
      workOnly = value;
    },
  };
}
