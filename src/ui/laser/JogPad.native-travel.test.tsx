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
// Controller audit 2 (ADR-375), pinned sources:
//  - with $20=1 GRBL rejects a whole jog line (error:15) when its MPos target
//    leaves [-$130, 0], homed or not, frame or no frame:
//    https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L346-L349
//  - homing trips the switch at that edge and rests $27 inside it, so the
//    switch does not re-trigger a hard limit ($21=1):
//    https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/limits.c#L366-L384

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
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
 *  travel: homing toward +X/+Y ($23=0), so machine space is [-400,0]x[-300,0],
 *  with soft and hard limits on and a 2 mm pull-off ($20=1 $21=1 $27=2). */
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
  stockGrblSettings({ bedWidth: 400, bedHeight: 300 }, 'confirmed');
}

/** Current-session $$ and $I of a stock GRBL 1.1h with soft and hard limits on. */
function stockGrblSettings(
  travel: { readonly bedWidth: number; readonly bedHeight: number },
  homingState: 'confirmed' | 'unknown',
): void {
  const observed = { sessionEpoch: 7, observedAt: 1 };
  useLaserStore.setState({
    controllerSessionEpoch: 7,
    homingState,
    activeControllerKind: 'grbl-v1.1',
    detectedControllerKind: 'grbl-v1.1',
    activeControllerCommandSet: null,
    controllerSettings: {
      softLimitsEnabled: true,
      hardLimitsEnabled: true,
      homingEnabled: true,
      homingPullOffMm: 2,
      ...travel,
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

  it('clamps to the verified native travel on homed stock GRBL, clear of the homing switch', async () => {
    vi.useFakeTimers();
    homedStockGrblEvidence();
    useLaserStore.setState({ statusReport: idleAt(-200, -150) });
    const { host, unmount } = await renderPad();
    try {
      // Toward the +X/+Y switches the hold ends at the $27 rest point (MPos
      // -2), not on the trip point at MPos 0 where a hard limit can fire.
      expect((await holdAndRelease(host, 'Jog +X 10 mm')).dx).toBeCloseTo(198, 6);
      // The far edge keeps a rounding margin: the report rounds MPos to 3
      // decimals and GRBL rejects a target even microns past -$130.
      expect((await holdAndRelease(host, 'Jog -X 10 mm')).dx).toBeCloseTo(-199.99, 6);
      expect((await holdAndRelease(host, 'Jog +Y 10 mm')).dy).toBeCloseTo(148, 6);
    } finally {
      await unmount();
    }
  });

  it('keeps the full-travel hold when this session read no $$', async () => {
    vi.useFakeTimers();
    useLaserStore.setState({ statusReport: idleAt(-200, -150) });
    const { host, unmount } = await renderPad();
    try {
      expect((await holdAndRelease(host, 'Jog +X 10 mm')).dx).toBe(400);
    } finally {
      await unmount();
    }
  });

  // The shipped 4040 profile has homing off, so it never gets a verified frame.
  // A full-bed hold ($J=G91 G21 X400) from MPos -200 targets +200, which GRBL
  // refuses whole with error:15; every direction must stay inside [-400, 0].
  it('stops a hold inside the firmware envelope when $20=1 and no frame is verified', async () => {
    vi.useFakeTimers();
    useStore.setState({
      project: { ...createProject(), device: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE },
    });
    stockGrblSettings({ bedWidth: 400, bedHeight: 400 }, 'confirmed');
    useLaserStore.setState({ statusReport: idleAt(-200, -200) });
    const { host, unmount } = await renderPad();
    try {
      expect((await holdAndRelease(host, 'Jog +X 10 mm')).dx).toBeCloseTo(198, 6);
      expect((await holdAndRelease(host, 'Jog -X 10 mm')).dx).toBeCloseTo(-199.99, 6);
      expect((await holdAndRelease(host, 'Jog +Y 10 mm')).dy).toBeCloseTo(198, 6);
      expect((await holdAndRelease(host, 'Jog -Y 10 mm')).dy).toBeCloseTo(-199.99, 6);
    } finally {
      await unmount();
    }
  });

  it('bounds the hold by MPos in a session that never homed, as GRBL still checks it', async () => {
    vi.useFakeTimers();
    useStore.setState({
      project: { ...createProject(), device: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE },
    });
    stockGrblSettings({ bedWidth: 400, bedHeight: 400 }, 'unknown');
    useLaserStore.setState({ statusReport: idleAt(-10, 0) });
    const { host, unmount } = await renderPad();
    try {
      expect((await holdAndRelease(host, 'Jog +X 10 mm')).dx).toBeCloseTo(8, 6);
      expect((await holdAndRelease(host, 'Jog -X 10 mm')).dx).toBeCloseTo(-389.99, 6);
    } finally {
      await unmount();
    }
  });
});
