// Rolling audit v4 H8-P2-2 (ADR-375 Amendment 8): the phone's hold aims as the
// PC's JogPad hold does, inside the controller's travel envelope measured from
// the head, and never past the 100 mm remote bound. Each case drives the real
// JogPad hold and the real remote executeHold on the same controller state.
// GRBL facts are pinned in JogPad.native-travel.test.tsx: homing rests $27
// inside the switch, and a tripped hard limit resets into ALARM:1.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { JogPad } from '../laser/JogPad';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { MachineRefusal } from './machine-actions';
import type { MachineExecutionContext } from './machine-execution';
import { executeHold, HOLD_MAX_TRAVEL_MM, HOLD_MAX_Z_TRAVEL_MM } from './machine-hold';
import type { OwnedMachineOperation } from './machine-operation-state';
import type { MachineCommand } from './machine-types';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type JogCall = { readonly dx?: number; readonly dy?: number; readonly dz?: number };
type HoldInput = Extract<MachineCommand, { readonly command: 'jog_hold_start' }>;
const original = useLaserStore.getState();
const STOP = new Error('captured');

function idleAt(x: number, y: number, z = 0) {
  return {
    state: 'Idle' as const,
    subState: null,
    mPos: { x, y, z },
    wPos: null,
    wco: null,
    feed: 0,
    spindle: 0,
  };
}

/** This session's $$ of a homed stock GRBL 1.1 homing toward +X/+Y/+Z ($23=0), so machine
 *  space is [-400,0]x[-300,0]x[-80,0], with hard limits on, soft limits off and a 2 mm pull-off
 *  ($20=0 $21=1 $27=2): nothing refuses a hold that runs onto a switch. */
function homedGrblSoftLimitsOff(): void {
  const observed = { sessionEpoch: 7, observedAt: 1 };
  useLaserStore.setState({
    controllerSessionEpoch: 7,
    homingState: 'confirmed',
    activeControllerKind: 'grbl-v1.1',
    detectedControllerKind: 'grbl-v1.1',
    activeControllerCommandSet: null,
    controllerSettings: {
      softLimitsEnabled: false,
      hardLimitsEnabled: true,
      homingEnabled: true,
      homingPullOffMm: 2,
      bedWidth: 400,
      bedHeight: 300,
      zTravelMm: 80,
      homingDirectionMask: 0,
      stepsPerMmX: 250,
      stepsPerMmY: 250,
      stepsPerMmZ: 250,
    },
    controllerSettingsObservation: observed,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
}

async function pcHold(label: string): Promise<JogCall | null> {
  const jog = vi.fn(async (_vector: JogCall) => undefined);
  useLaserStore.setState({ jog, cancelJog: vi.fn(async () => undefined) });
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<JogPad disabled={false} />);
  });
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  );
  if (button === undefined) throw new Error(`missing button ${label}`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    await vi.advanceTimersByTimeAsync(250);
  });
  await act(async () => {
    button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
  });
  await act(async () => root?.unmount());
  host.remove();
  return jog.mock.calls[0]?.[0] ?? null;
}

/** The real remote hold up to the jog it asks for; the jog itself is captured, not sent. */
async function remoteHold(axis: 'x' | 'y' | 'z', direction: -1 | 1): Promise<JogCall | Error> {
  const jog = vi.fn(async (_vector: JogCall) => {
    throw STOP;
  });
  useLaserStore.setState({ jog });
  const input = {
    command: 'jog_hold_start',
    args: { axis, direction, requestId: crypto.randomUUID(), expectedRevision: 'r' },
  } as unknown as HoldInput;
  const operation = {
    kind: 'hold',
    state: 'running',
    committed: false,
    controller: new AbortController(),
    controllerEpoch: useLaserStore.getState().controllerSessionEpoch,
    cleanup: () => undefined,
  } as unknown as OwnedMachineOperation;
  const context = { options: {} } as unknown as MachineExecutionContext;
  try {
    await executeHold(input, operation, context, {} as never);
  } catch (error) {
    if (error !== STOP) return error as Error;
  }
  return jog.mock.calls[0]?.[0] ?? new Error('no jog');
}

beforeEach(() => {
  vi.useFakeTimers();
  useStore.setState({
    project: {
      ...createProject(),
      device: { ...createProject().device, bedWidth: 400, bedHeight: 300 },
    },
  });
  useLaserStore.setState({
    capabilities: { ...original.capabilities, jogCancel: true },
  });
});
afterEach(() => {
  useLaserStore.setState(original, true);
  useStore.setState({ project: createProject() });
  vi.useRealTimers();
});

describe('the phone hold aims as the PC hold does', () => {
  it('stops short of the homing switch where the PC hold stops (audit repro: 18 mm, not 100)', async () => {
    homedGrblSoftLimitsOff();
    useLaserStore.setState({ statusReport: idleAt(-20, -150) });
    const pc = await pcHold('Jog +X 10 mm');
    expect(pc?.dx).toBeCloseTo(18, 6);
    const remote = await remoteHold('x', 1);
    expect(remote).not.toBeInstanceOf(Error);
    expect((remote as JogCall).dx).toBeCloseTo(pc?.dx ?? NaN, 6);
  });

  it('keeps the 100 mm remote bound where the PC hold would travel further', async () => {
    homedGrblSoftLimitsOff();
    useLaserStore.setState({ statusReport: idleAt(-20, -150) });
    expect((await pcHold('Jog -Y 10 mm'))?.dy).toBeCloseTo(-150, 6);
    expect(await remoteHold('y', -1)).toEqual({ dy: -HOLD_MAX_TRAVEL_MM, feed: 3000 });
  });

  it('keeps the 100 mm bound when this session read no $$, as before', async () => {
    useLaserStore.setState({ statusReport: idleAt(-200, -150) });
    expect((await pcHold('Jog +X 10 mm'))?.dx).toBe(400);
    expect(await remoteHold('x', 1)).toEqual({ dx: HOLD_MAX_TRAVEL_MM, feed: 3000 });
  });

  it('refuses a hold at the travel edge, where the PC hold sends nothing', async () => {
    homedGrblSoftLimitsOff();
    useLaserStore.setState({ statusReport: idleAt(-2, -150) });
    expect(await pcHold('Jog +X 10 mm')).toBeNull();
    const remote = await remoteHold('x', 1);
    expect(remote).toBeInstanceOf(MachineRefusal);
    expect((remote as Error).message).toBe(
      'The head is already at the travel limit in that direction.',
    );
  });
});

describe('the phone Z hold', () => {
  it('stops the pull-off short of the Z homing switch and keeps its 20 mm bound', async () => {
    useStore.setState((state) => ({
      project: { ...state.project, machine: DEFAULT_CNC_MACHINE_CONFIG },
    }));
    homedGrblSoftLimitsOff();
    useLaserStore.setState({ statusReport: idleAt(-200, -150, -10) });
    expect(await remoteHold('z', 1)).toEqual({ dz: 8, feed: 600 });
    expect(await remoteHold('z', -1)).toEqual({ dz: -HOLD_MAX_Z_TRAVEL_MM, feed: 600 });
  });

  it('follows the running job’s machine, as the phone Z step does (ADR-416 Amendment 3)', async () => {
    // A Laser project whose profile has no Z axis: Z hold is off with no job running.
    const laserOnly = await remoteHold('z', 1);
    expect(laserOnly).toBeInstanceOf(Error);
    expect((laserOnly as Error & { code?: string }).code).toBe('unsupported_operation');
    useLaserStore.setState({
      streamer: { status: 'paused' },
      activeJobMachineKind: 'cnc',
    } as never);
    expect(await remoteHold('z', 1)).toEqual({ dz: HOLD_MAX_Z_TRAVEL_MM, feed: 600 });
  });
});
