// Controller audit 2 (ADR-375), C-2: motion the controller reports with no
// owner here (a Console G1, $J= or $H) left the Live Motion bar empty, so
// Disconnect was the only software stop.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GrblState } from '../../core/controllers/grbl';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { LiveMotionBar } from './LiveMotionBar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type StatusReport = NonNullable<ReturnType<typeof useLaserStore.getState>['statusReport']>;

const realStopJob = useLaserStore.getState().stopJob;

function report(state: GrblState, subState: number | null = null, door = false): StatusReport {
  return {
    state,
    subState,
    mPos: { x: 0, y: 0, z: 0 },
    wPos: null,
    feed: 0,
    spindle: 0,
    wco: null,
    ...(door
      ? { pins: { limitX: false, limitY: false, limitZ: false, probe: false, door: true } }
      : {}),
  } as StatusReport;
}

async function render(): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<LiveMotionBar />));
  return { host, root };
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((button) => button.textContent === text);
}

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    motionOperation: null,
    mpgActive: null,
    resetRequired: false,
    stopJob: realStopJob,
  });
  document.body.innerHTML = '';
});

describe('LiveMotionBar with motion the controller reports and nothing here owns', () => {
  it.each([
    ['Run', 'MACHINE MOVING'],
    ['Jog', 'JOGGING'],
    ['Home', 'HOMING'],
  ] as const)('shows %s as %s with ABORT MOTION wired to Abort', async (state, heading) => {
    const stopJob = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: report(state),
      stopJob,
    });
    const { host, root } = await render();
    try {
      expect(host.textContent).toContain(heading);
      const abort = buttonByText(host, 'ABORT MOTION');
      expect(abort).toBeInstanceOf(HTMLButtonElement);
      expect(buttonByText(host, 'Pause')).toBeUndefined();
      await act(async () => abort?.click());
      expect(stopJob).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
    }
  });

  // Stock GRBL that refused `$HX` stays in its homing state with no cycle
  // running; the popup must not call that a homing cycle (ADR-375 A-7).
  it('names the homing state a refused $HX left, with ABORT MOTION', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: report('Home'),
      resetRequired: 'homing-state',
    });
    const { host, root } = await render();
    try {
      expect(host.textContent).toContain('HOMING STATE');
      expect(host.textContent).toContain('no homing cycle running');
      expect(buttonByText(host, 'ABORT MOTION')).toBeInstanceOf(HTMLButtonElement);
    } finally {
      await act(async () => root.unmount());
    }
  });

  // No Resume: releasing a hold the app never requested stays with the
  // machine's cycle start, as for a controller hold during a job (ADR-333).
  it('names a controller hold with Abort and no Resume', async () => {
    useLaserStore.setState({ connection: { kind: 'connected' }, statusReport: report('Hold', 0) });
    const { host, root } = await render();
    try {
      expect(host.textContent).toContain('CONTROLLER HOLD');
      expect(host.textContent).toContain('cycle start');
      expect(buttonByText(host, 'ABORT MOTION')).toBeInstanceOf(HTMLButtonElement);
      expect(buttonByText(host, 'Resume')).toBeUndefined();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('names an open door the controller reports', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: report('Door', 1, true),
    });
    const { host, root } = await render();
    try {
      expect(host.textContent).toContain('CONTROLLER DOOR HOLD');
      expect(host.textContent).toContain('door or lid input open');
      expect(buttonByText(host, 'ABORT MOTION')).toBeInstanceOf(HTMLButtonElement);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps the owned jog description when KerfDesk started the jog', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: report('Jog'),
      motionOperation: { kind: 'jog' } as ReturnType<
        typeof useLaserStore.getState
      >['motionOperation'],
    });
    const { host, root } = await render();
    try {
      expect(host.textContent).toContain('Controller motion is active');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it.each([
    ['disconnected', { connection: { kind: 'disconnected' } }],
    ['Idle', { connection: { kind: 'connected' }, statusReport: report('Idle') }],
    // A grblHAL pendant that owns motion is its own owner (MPG:1).
    ['MPG-owned', { connection: { kind: 'connected' }, mpgActive: true }],
  ] as const)('stays hidden when %s', async (_name, patch) => {
    useLaserStore.setState({ statusReport: report('Run'), ...patch });
    const { host, root } = await render();
    try {
      expect(host.firstElementChild).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
