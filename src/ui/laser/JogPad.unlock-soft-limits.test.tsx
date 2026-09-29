// After an Unlock without Home KerfDesk stops trusting the reported position,
// yet stock GRBL with $20=1 still checks every jog target against its own
// machine position, and $X leaves that position as it was. A hold aimed from
// an unknown position asked for the full travel, which GRBL refuses whole
// (error:15) from almost anywhere, so after connecting into the boot Alarm and
// unlocking, every hold failed (controller audit 2, M-3, ADR-375). Driven
// through the real laser store and its status pipeline, the GRBL simulator
// and the JogPad hold. Pinned GRBL 1.1h sources:
//  - with homing on, power-up locks into Alarm (HOMING_INIT_LOCK):
//    https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/main.c#L65-L67
//  - $X only leaves the Alarm state; sys_position is untouched:
//    https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L160-L168
//  - a jog target is checked whenever $20=1, homed or not, and must stay
//    inside [-$130, 0] ($23=0, no HOMING_FORCE_SET_ORIGIN):
//    https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/jog.c#L35-L37
//    https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L346-L349

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator, type GrblSimulator } from '../../__fixtures__/controllers';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { beginReportUnitsWrite } from '../state/controller-report-units';
import { useLaserStore } from '../state/laser-store';
import { JogPad } from './JogPad';
import { DEFAULT_JOG_STEP_MM, useJogControlPreferences } from './jog-control-preferences';
import { DEFAULT_JOG_FEED_MM_PER_MIN } from './jog-control-policy';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const original = useLaserStore.getState();

type HoldLabel = 'Jog +X 10 mm' | 'Jog -X 10 mm';

/** A 4040-class stock GRBL 1.1h: homing on ($22=1), so it boots locked in
 *  Alarm; soft and hard limits on; a 2 mm pull-off; homing toward +X/+Y
 *  ($23=0); 400 x 400 travel. */
function lockedSoftLimitedGrbl(): GrblSimulator {
  return createGrblSimulator({
    homingInitLock: true,
    settings: [
      [20, '1'],
      [21, '1'],
      [22, '1'],
      [23, '0'],
      [27, '2.000'],
      [130, '400.000'],
      [131, '400.000'],
    ],
  });
}

async function pump(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function settle(action: Promise<void>): Promise<void> {
  let settled = false;
  const tracked = action.finally(() => {
    settled = true;
  });
  for (let tick = 0; tick < 400 && !settled; tick += 1) await pump(5);
  await tracked;
}

/** Connect into the boot Alarm, Unlock without Home, and step-jog the head to
 *  MPos -50,-50, where KerfDesk no longer shows a position. */
async function unlockedWithoutHome(sim: GrblSimulator): Promise<void> {
  useStore.setState({
    project: { ...createProject(), device: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE },
  });
  await useLaserStore.getState().connect(sim.adapter);
  await pump(2_000);
  expect(useLaserStore.getState().statusReport?.state).toBe('Alarm');
  await settle(useLaserStore.getState().unlockAlarm());
  await settle(useLaserStore.getState().jog({ dx: -50, dy: -50, feed: 1_000 }));
  await pump(2_000);
  expect(sim.state().mpos).toEqual({ x: -50, y: -50, z: 0 });
  const state = useLaserStore.getState();
  expect(state.positionEvidenceSuppressed).toBe(true);
  expect(state.homingState).toBe('unknown');
  expect(state.statusReport?.state).toBe('Idle');
  expect(state.controllerSettings?.softLimitsEnabled).toBe(true);
  // Everything but the hold clamp still treats the position as unknown.
  expect(state.statusReport?.mPos ?? null).toBeNull();
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

function buttonByLabel(host: HTMLElement, label: HoldLabel): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  );
  if (button === undefined) throw new Error(`missing button ${label}`);
  return button;
}

/** One press-and-hold; returns the X distance it asked the store for. With
 *  `send` the real store sends it to the simulator before the release. */
async function holdX(host: HTMLElement, label: HoldLabel, send: boolean): Promise<number> {
  const storeJog = useLaserStore.getState().jog;
  const jog = vi.fn<typeof storeJog>(send ? storeJog : async () => undefined);
  useLaserStore.setState({ jog });
  const button = buttonByLabel(host, label);
  await act(async () => {
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    await vi.advanceTimersByTimeAsync(250);
  });
  await pump(500);
  await act(async () => {
    button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
  });
  await pump(2_000);
  useLaserStore.setState({ jog: storeJog });
  expect(jog).toHaveBeenCalledTimes(1);
  return jog.mock.calls[0]?.[0].dx ?? 0;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(original, true);
  useStore.setState({ project: createProject() });
  useJogControlPreferences.setState({
    stepMm: DEFAULT_JOG_STEP_MM,
    requestedFeedMmPerMin: DEFAULT_JOG_FEED_MM_PER_MIN,
  });
  vi.restoreAllMocks();
});

describe('hold-to-jog after an Unlock without Home on stock GRBL with $20=1', () => {
  it('stays inside the envelope GRBL checks from its own MPos', async () => {
    const sim = lockedSoftLimitedGrbl();
    await unlockedWithoutHome(sim);
    const { host, unmount } = await renderPad();
    try {
      // From MPos -50 the far edge keeps the rounding margin inside -$130,
      // so GRBL takes the line (no error:15) and the head reaches it...
      const towardFarEdge = await holdX(host, 'Jog -X 10 mm', true);
      expect(useLaserStore.getState().lastError).toBeNull();
      expect(sim.state().mpos.x).toBeCloseTo(-399.99, 6);
      expect(towardFarEdge).toBeCloseTo(-349.99, 6);
      // ...and the homing edge stops the same margin inside the $27 rest
      // point, clear of the switch.
      const towardSwitch = await holdX(host, 'Jog +X 10 mm', true);
      expect(useLaserStore.getState().lastError).toBeNull();
      expect(sim.state().mpos.x).toBeCloseTo(-2.01, 6);
      expect(towardSwitch).toBeCloseTo(397.98, 6);
    } finally {
      await unmount();
    }
  });

  // Unconfirmed report units (a Console `$13=` write not yet re-read) leave no
  // controller MPos to aim from: the hold asks for the full envelope width, as
  // before, and relies on release plus the jog-cancel byte.
  it('keeps the full-travel request while the report units are unconfirmed', async () => {
    await unlockedWithoutHome(lockedSoftLimitedGrbl());
    useLaserStore.setState(beginReportUnitsWrite());
    await pump(2_000);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
    const { host, unmount } = await renderPad();
    try {
      expect(await holdX(host, 'Jog -X 10 mm', false)).toBeCloseTo(-397.98, 6);
    } finally {
      await unmount();
    }
  });
});
