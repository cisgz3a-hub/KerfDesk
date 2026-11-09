// Rolling audit v12 X5-P2-1, against the GRBL simulator with the real store and
// the real Live Motion bar: a door opened after every line was sent, while the
// planner still runs the finishing tail, said "press Pause and then Resume
// here" beside ABORT JOB alone, and the job never finished. The bar now offers
// Pause there, and Pause then Resume finishes the job (ADR-207 Amendment 4).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useLaserStore } from '../state/laser-store';
import { LiveMotionBar } from './LiveMotionBar';
import {
  drive,
  harness,
  installRecoveryStressHooks,
  startFramedJob,
  STRESS_TIMEOUT_MS,
  tick,
} from './recovery-stress-testing';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

installRecoveryStressHooks();

async function renderBar(): Promise<{ readonly host: HTMLElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<LiveMotionBar />));
  return { host, root };
}

function barButton(host: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [
    ...host.querySelectorAll<HTMLButtonElement>('section[aria-label="Live Motion"] button'),
  ].find((button) => button.textContent === label);
}

/** Ticks until `done` holds, at most `steps` times. */
async function waitUntil(done: () => boolean, steps: number, ms: number): Promise<boolean> {
  for (let i = 0; i < steps && !done(); i += 1) await act(async () => tick(ms));
  return done();
}

describe('a door hold in the finishing tail (X5-P2-1)', () => {
  it(
    'offers the Pause the door text names, and Pause then Resume finishes the job',
    async () => {
      const h = await harness();
      const { running } = await startFramedJob(h.repository);
      // Every line sent, the simulator's planner still holding motion.
      const inTail = (): boolean =>
        useLaserStore.getState().streamer?.status === 'done' &&
        h.simulator.state().pendingMotions > 0;
      expect(await waitUntil(inTail, 4_000, 2)).toBe(true);

      h.simulator.setDoorInput(true);
      await tick(600);
      const { host, root } = await renderBar();
      try {
        expect(useLaserStore.getState().statusReport?.state).toBe('Door');
        expect(host.textContent).toContain('Press Pause and then Resume here');
        const pause = barButton(host, 'Pause');
        expect(pause).toBeInstanceOf(HTMLButtonElement);

        h.simulator.setDoorInput(false);
        await tick(300);
        await act(async () => pause?.click());
        // Pause shows "Pausing…" until the controller confirms; then Resume.
        expect(await waitUntil(() => barButton(host, 'Resume') !== undefined, 400, 10)).toBe(true);
        await act(async () => barButton(host, 'Resume')?.click());
        expect(await waitUntil(() => useLaserStore.getState().streamer === null, 600, 50)).toBe(
          true,
        );
        await drive(running, 30_000).catch(() => undefined);
        expect(h.simulator.state().pendingMotions).toBe(0);
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
    STRESS_TIMEOUT_MS * 2,
  );
});
