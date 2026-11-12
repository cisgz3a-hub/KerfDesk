// Shared by the CNC bit-change suites (annoyance audit A2 B4-P1-1, ADR-416
// Amendment 4). A multi-bit CNC project (__fixtures__/cnc-multi-bit-project)
// runs on the GRBL simulator through the real Frame, Start and Job Review flows
// of recovery-stress-testing, and the hold is worked on the rendered Machine
// rail and Live Motion bar: the Zero Z button, the probe panel, the "Bit in the
// spindle" selector and Continue.
// Suites importing this module must mock '../state/job-aware-dialogs' and
// '../state/app-dialogs', and call installRecoveryStressHooks().

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GrblSimulator } from '../../__fixtures__/controllers';
import { PlatformProvider } from '../app/platform-context';
import { useLaserStore } from '../state/laser-store';
import { toolChangeReady } from '../state/laser-store-helpers';
import { LaserWindow } from './LaserWindow';
import { LiveMotionBar } from './LiveMotionBar';
import { tick } from './recovery-stress-testing';

export const ZERO_Z_LABEL = 'Zero work Z at current bit height';

export type RenderedRail = {
  readonly host: HTMLElement;
  /** The first button with this accessible name or text. */
  readonly button: (name: string) => HTMLButtonElement;
  readonly click: (name: string) => Promise<void>;
  readonly text: () => string;
  readonly unmount: () => Promise<void>;
};

/** Renders the Machine rail and the Live Motion bar against the simulator. */
export async function renderRail(simulator: GrblSimulator): Promise<RenderedRail> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={simulator.adapter}>
        <LaserWindow />
        <LiveMotionBar />
      </PlatformProvider>,
    );
  });
  const button = (name: string): HTMLButtonElement => {
    const found = [...host.querySelectorAll('button')].find(
      (node) => node.getAttribute('aria-label') === name || node.textContent?.trim() === name,
    );
    if (found === undefined) throw new Error(`Missing button: ${name}`);
    return found;
  };
  return {
    host,
    button,
    click: async (name) => {
      const target = button(name);
      if (target.disabled || target.getAttribute('aria-disabled') === 'true') {
        throw new Error(`Button is disabled: ${name} (${target.title})`);
      }
      await act(async () => target.click());
    },
    text: () => host.textContent ?? '',
    unmount: async () => {
      await act(async () => root?.unmount());
      host.remove();
    },
  };
}

/** The rail's "Bit in the spindle" selector. */
export function spindleBitSelect(rail: RenderedRail): HTMLSelectElement {
  const select = rail.host.querySelector('select[aria-label="Bit in the spindle"]');
  if (!(select instanceof HTMLSelectElement)) throw new Error('Missing Bit in the spindle');
  return select;
}

/** Chooses a bit in the rail's selector, as an operator would. */
export async function chooseSpindleBit(rail: RenderedRail, toolId: string): Promise<void> {
  const select = spindleBitSelect(rail);
  if (select.disabled) throw new Error('Bit in the spindle is disabled');
  await act(async () => {
    select.value = toolId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** Why the Live Motion bar's Continue is off, or null when it can be pressed.
 * The button uses aria-disabled so it keeps focus (LiveMotionActionButton). */
export function continueBlock(rail: RenderedRail): string | null {
  const button = rail.button('Continue');
  return button.getAttribute('aria-disabled') === 'true' ? button.title : null;
}

/** Presses the rail's Zero Z and waits for the controller to take it. */
export async function pressZeroZ(rail: RenderedRail): Promise<void> {
  await rail.click(ZERO_Z_LABEL);
  await tick(1_500);
}

/** Runs the rendered touch-plate Z probe: the test touch, then Run probe. */
export async function runRenderedZProbe(
  rail: RenderedRail,
  simulator: GrblSimulator,
): Promise<void> {
  simulator.setProbeInput(true);
  await tick(600);
  simulator.setProbeInput(false);
  await tick(600);
  await rail.click('Run probe');
  for (let step = 0; step < 400 && useLaserStore.getState().probeBusy; step += 1) await tick(50);
  await tick(1_500);
}

/** Advances the simulated clock until the job holds settled at a bit change,
 * or ends. Returns the stream's status ('ended' once it is released). */
export async function runToHoldOrEnd(limitMs = 120_000): Promise<string> {
  for (let elapsed = 0; elapsed < limitMs; elapsed += 50) {
    const state = useLaserStore.getState();
    if (state.streamer === null) return 'ended';
    if (state.streamer.status === 'tool-change' && toolChangeReady(state)) return 'tool-change';
    if (state.streamer.status === 'cancelled' || state.streamer.status === 'errored') {
      return state.streamer.status;
    }
    await tick(50);
  }
  return useLaserStore.getState().streamer?.status ?? 'ended';
}

/** Anything the controller or the store complained about during the run. */
export function controllerProblems(): string[] {
  const state = useLaserStore.getState();
  return [
    ...(state.safetyNotice === null ? [] : [state.safetyNotice.message]),
    ...(state.alarmCode === null ? [] : [`ALARM:${state.alarmCode}`]),
    ...(state.lastWriteError === null ? [] : [state.lastWriteError]),
    ...state.log.filter((line) => /error:|ALARM/i.test(line)),
  ];
}
