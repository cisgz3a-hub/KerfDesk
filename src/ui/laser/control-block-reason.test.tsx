// Annoyance audit A3-P3-4: a control that is off says why in its tooltip, in
// the words the store would throw; an enabled one keeps its ordinary tooltip.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { useStore } from '../state';
import { CONTROLLER_OPERATION_ACTIVE_MESSAGE } from '../state/laser-controller-operation';
import { startMotionOperation } from '../state/laser-motion-operation';
import { useLaserStore, type LaserState } from '../state/laser-store';
import {
  ACTIVE_JOB_COMMAND_MESSAGE,
  AUTOFOCUS_BUSY_MESSAGE,
  CONNECT_MACHINE_FIRST,
  MOTION_OPERATION_ACTIVE_MESSAGE,
} from '../state/laser-store-helpers';
import { ConnectionBar } from './ConnectionBar';
import {
  connectionControlBlockReason,
  jogPadBlockReason,
  setupControlBlockReason,
  titleWhenDisabled,
} from './control-block-reason';
import { JobSetupControls } from './JobSetupControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const IDLE = {
  state: 'Idle' as const,
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  wco: null,
  feed: 0,
  spindle: 0,
};
const JOG_OPERATION = startMotionOperation('jog', [], undefined, 0, 0, undefined, 'G4 P0.01\n');

function state(overrides: Partial<LaserState>): LaserState {
  return {
    ...useLaserStore.getState(),
    connection: { kind: 'connected' },
    statusReport: IDLE,
    ...overrides,
  } as LaserState;
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(element: JSX.Element): Promise<HTMLDivElement> {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  host = mount;
  await act(async () => {
    root = createRoot(mount);
    root.render(element);
  });
  return mount;
}

function buttonByText(mount: HTMLElement, text: string): HTMLButtonElement {
  const found = [...mount.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (found === undefined) throw new Error(`button "${text}" is missing`);
  return found;
}

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  useStore.getState().newProject();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    motionOperation: null,
  } as Partial<LaserState>);
});

describe('block reasons', () => {
  it('names nothing on a connected, idle machine', () => {
    expect(setupControlBlockReason(state({}))).toBeNull();
    expect(jogPadBlockReason(state({}))).toBeNull();
  });

  it('says to connect first', () => {
    const disconnected = state({ connection: { kind: 'disconnected' }, statusReport: null });
    expect(setupControlBlockReason(disconnected)).toBe(CONNECT_MACHINE_FIRST);
    expect(jogPadBlockReason(disconnected)).toBe(CONNECT_MACHINE_FIRST);
  });

  it('names auto-focus, a running jog or Frame, and a running job', () => {
    expect(setupControlBlockReason(state({ autofocusBusy: true }))).toBe(AUTOFOCUS_BUSY_MESSAGE);
    expect(setupControlBlockReason(state({ motionOperation: JOG_OPERATION }))).toBe(
      MOTION_OPERATION_ACTIVE_MESSAGE,
    );
    expect(jogPadBlockReason(state({ motionOperation: JOG_OPERATION }))).toBe(
      MOTION_OPERATION_ACTIVE_MESSAGE,
    );
    const streamer = step(createStreamer('G0 X0\nG0 X1')).state;
    expect(setupControlBlockReason(state({ streamer }))).toBe(ACTIVE_JOB_COMMAND_MESSAGE);
  });

  it('holds the jog arrows, and only them, to a reported Idle', () => {
    const alarm = state({ statusReport: { ...IDLE, state: 'Alarm' } });
    expect(setupControlBlockReason(alarm)).toBeNull();
    expect(jogPadBlockReason(alarm)).toContain('currently Alarm');
  });

  it('names what holds the connection controls', () => {
    expect(connectionControlBlockReason(JOG_OPERATION)).toBe(MOTION_OPERATION_ACTIVE_MESSAGE);
    expect(connectionControlBlockReason(null)).toBe(CONTROLLER_OPERATION_ACTIVE_MESSAGE);
  });

  it('shows a reason only while the control is off', () => {
    expect(titleWhenDisabled(true, 'Busy.', 'Does a thing.')).toBe('Busy.');
    expect(titleWhenDisabled(false, 'Busy.', 'Does a thing.')).toBe('Does a thing.');
    expect(titleWhenDisabled(true, null, 'Does a thing.')).toBe('Does a thing.');
  });

  it('never names a firmware, since Marlin and Smoothieware show it too', () => {
    expect(MOTION_OPERATION_ACTIVE_MESSAGE).not.toMatch(/GRBL/i);
  });
});

describe('disabled controls carry their reason', () => {
  function homeControls(streaming: boolean): JSX.Element {
    return (
      <JobSetupControls
        disabled={false}
        streaming={streaming}
        onConfigureAutofocus={() => undefined}
        onConfigureHoming={() => undefined}
        actions="home"
      />
    );
  }

  it('Home says a jog is running, then reads as usual once it can be pressed', async () => {
    useStore.getState().updateDeviceProfile({ homing: { enabled: true, direction: 'front-left' } });
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: IDLE,
      motionOperation: JOG_OPERATION,
    } as Partial<LaserState>);
    const mount = await render(homeControls(true));
    const home = buttonByText(mount, 'Home');
    expect(home.disabled).toBe(true);
    expect(home.title).toBe(MOTION_OPERATION_ACTIVE_MESSAGE);

    useLaserStore.setState({ motionOperation: null } as Partial<LaserState>);
    await act(async () => root?.render(homeControls(false)));
    expect(home.disabled).toBe(false);
    expect(home.title).toContain('to establish the machine reference');
  });

  it('Disconnect says what holds it', async () => {
    const mount = await render(
      <ConnectionBar
        machineName="Test machine"
        connection={{ kind: 'connected' }}
        machineNoun="laser"
        onConnect={() => undefined}
        onDisconnect={() => undefined}
        onForget={() => undefined}
        disabled
        disabledReason={MOTION_OPERATION_ACTIVE_MESSAGE}
      />,
    );
    const disconnect = buttonByText(mount, 'Disconnect');
    expect(disconnect.disabled).toBe(true);
    expect(disconnect.title).toBe(MOTION_OPERATION_ACTIVE_MESSAGE);
  });
});
