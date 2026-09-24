// Press-and-hold jog runs to the travel edge, so it must reason in the
// controller's native machine coordinates (controller audit 2026-09-23,
// jog-home-origin-3). Driven through the real JogPad hold (pointerdown, hold
// delay, pointerup). GRBL v1.1 facts, primary sources:
//  - main.c clears sys_position at power-up, so a machine without homing
//    reports MPos 0,0 wherever the head sits;
//  - config.h: after homing, GRBL sets the whole machine space into negative
//    space unless HOMING_FORCE_SET_ORIGIN is compiled in.
//    https://github.com/gnea/grbl/blob/master/grbl/config.h
// The profile bed is 0..width, so comparing raw MPos with it made a held arrow
// do nothing toward the origin and overshoot the other way.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { JogPad } from './JogPad';
import { DEFAULT_JOG_STEP_MM, useJogControlPreferences } from './jog-control-preferences';
import { DEFAULT_JOG_FEED_MM_PER_MIN } from './jog-control-policy';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const original = useLaserStore.getState();

type JogCall = { readonly dx?: number; readonly dy?: number };

function idleAt(x: number, y: number) {
  return {
    state: 'Idle' as const,
    subState: null,
    mPos: { x, y, z: 0 },
    wPos: null,
    wco: null,
    feed: 0,
    spindle: 0,
  };
}

function buttonByLabel(host: HTMLElement, label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  );
  if (button === undefined) throw new Error(`missing button ${label}`);
  return button;
}

async function holdAndRelease(host: HTMLElement, label: string): Promise<JogCall> {
  const jog = vi.fn(async (_vector: JogCall) => undefined);
  useLaserStore.setState({ jog, cancelJog: vi.fn(async () => undefined) });
  const button = buttonByLabel(host, label);
  await act(async () => {
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    await vi.advanceTimersByTimeAsync(250);
  });
  await act(async () => {
    button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
  });
  expect(jog).toHaveBeenCalledTimes(1);
  return jog.mock.calls[0]?.[0] ?? {};
}

async function renderPad(): Promise<{ host: HTMLDivElement; unmount: () => Promise<void> }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<JogPad disabled={false} />);
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

/** A homed stock GRBL 1.1 session whose current $$ and $I prove the native
 *  travel: homing toward +X/+Y ($23=0), so machine space is [-400,0]x[-300,0]. */
function homedStockGrblEvidence(): void {
  useStore.setState((state) => ({
    project: {
      ...state.project,
      device: {
        ...state.project.device,
        bedWidth: 400,
        bedHeight: 300,
        homing: { ...state.project.device.homing, enabled: true },
      },
    },
  }));
  const observed = { sessionEpoch: 7, observedAt: 1 };
  useLaserStore.setState({
    controllerSessionEpoch: 7,
    homingState: 'confirmed',
    activeControllerKind: 'grbl-v1.1',
    detectedControllerKind: 'grbl-v1.1',
    activeControllerCommandSet: null,
    controllerSettings: {
      homingEnabled: true,
      bedWidth: 400,
      bedHeight: 300,
      homingDirectionMask: 0,
    },
    controllerSettingsObservation: observed,
    controllerBuildInfo: {
      protocolVersion: '1.1h',
      buildRevision: '20190830',
      userInfo: '',
      optionCodes: [],
      plannerBufferBlocks: 15,
      rxBufferBytes: 128,
    },
    controllerBuildInfoObservation: observed,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
}

afterEach(() => {
  useLaserStore.setState(original, true);
  useStore.setState({ project: createProject() });
  useJogControlPreferences.setState({
    stepMm: DEFAULT_JOG_STEP_MM,
    requestedFeedMmPerMin: DEFAULT_JOG_FEED_MM_PER_MIN,
  });
  vi.useRealTimers();
});

describe('hold-to-jog in native travel', () => {
  it('jogs toward the origin on a machine without homing at power-up MPos 0,0', async () => {
    vi.useFakeTimers();
    useLaserStore.setState({ statusReport: idleAt(0, 0) });
    const { host, unmount } = await renderPad();
    try {
      expect((await holdAndRelease(host, 'Jog -X 10 mm')).dx).toBeLessThan(0);
      expect((await holdAndRelease(host, 'Jog -Y 10 mm')).dy).toBeLessThan(0);
    } finally {
      await unmount();
    }
  });

  it('clamps to the verified native travel on homed stock GRBL', async () => {
    vi.useFakeTimers();
    homedStockGrblEvidence();
    useLaserStore.setState({ statusReport: idleAt(-200, -150) });
    const { host, unmount } = await renderPad();
    try {
      expect((await holdAndRelease(host, 'Jog +X 10 mm')).dx).toBeCloseTo(200, 6);
      expect((await holdAndRelease(host, 'Jog -X 10 mm')).dx).toBeCloseTo(-200, 6);
      expect((await holdAndRelease(host, 'Jog +Y 10 mm')).dy).toBeCloseTo(150, 6);
    } finally {
      await unmount();
    }
  });

  it('never asks for more than the configured travel when the frame is unknown', async () => {
    vi.useFakeTimers();
    useLaserStore.setState({ statusReport: idleAt(-200, -150) });
    const { host, unmount } = await renderPad();
    try {
      const vector = await holdAndRelease(host, 'Jog +X 10 mm');
      expect(Math.abs(vector.dx ?? 0)).toBeLessThanOrEqual(400);
      expect(vector.dx ?? 0).toBeGreaterThan(0);
    } finally {
      await unmount();
    }
  });
});
