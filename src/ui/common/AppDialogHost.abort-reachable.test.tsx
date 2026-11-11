// PROJECT.md non-negotiable 9: no modal may block the Abort control during a
// job. An in-app dialog (ADR-707) is allowed to open while a job runs only
// because it leaves the Live Motion bar's ABORT JOB above it, enabled, exposed
// to assistive technology and working, and leaves the page running.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { LiveMotionBar } from '../laser/LiveMotionBar';
import { clearAppDialogs } from '../state/app-dialog-test-helpers';
import { appAlert, appConfirm, appPrompt } from '../state/app-dialogs';
import { useLaserStore } from '../state/laser-store';
import { useUiStore } from '../state/ui-store';
import { AppDialogHost } from './AppDialogHost';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const realStopJob = useLaserStore.getState().stopJob;
const stopJob = vi.fn(async () => undefined);

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  stopJob.mockClear();
  useLaserStore.setState({
    streamer: step(createStreamer('G1 X1 S100\nG1 X2 S100\nG1 X3 S100')).state,
    stopJob,
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    // The order App.tsx mounts them in: the bar, then the dialog host.
    root.render(
      <>
        <main>
          <button type="button">A workspace control</button>
        </main>
        <LiveMotionBar />
        <AppDialogHost />
      </>,
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearAppDialogs();
  useLaserStore.setState({ streamer: null, stopJob: realStopJob });
  useUiStore.setState({ modalDepth: 0 });
});

function abortButton(): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent === 'ABORT JOB');
  if (found === undefined) throw new Error('ABORT JOB is not on screen');
  return found;
}

function dialog(): HTMLElement {
  const node = host.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
  if (node === null) throw new Error('no dialog is open');
  return node;
}

/** The z-index a design token resolves to in tokens.css. */
function tokenZIndex(token: string): number {
  const css = readFileSync('src/ui/theme/tokens.css', 'utf8');
  const match = new RegExp(`${token}:\\s*(\\d+);`).exec(css);
  if (match?.[1] === undefined) throw new Error(`${token} is not defined in tokens.css`);
  return Number(match[1]);
}

const QUESTIONS = [
  {
    name: 'confirm',
    open: (): Promise<unknown> =>
      appConfirm({ title: 'Delete preset?', message: 'Delete "Birch"?', confirmLabel: 'Delete' }),
  },
  {
    name: 'alert',
    open: (): Promise<unknown> => appAlert({ title: 'Imported', message: 'Three presets.' }),
  },
  {
    name: 'prompt',
    open: (): Promise<unknown> =>
      appPrompt({ title: 'Save preset', message: '', label: 'Preset name', confirmLabel: 'Save' }),
  },
] as const;

describe.each(QUESTIONS)('an in-app $name during a running job', ({ open }) => {
  it('leaves ABORT JOB enabled, exposed and working, and stays open', async () => {
    let settled = false;
    await act(async () => {
      void open().then(() => {
        settled = true;
      });
    });
    // Let hideOutsideModal's observer settle, as it does in the browser.
    await act(async () => {
      await Promise.resolve();
    });
    const abort = abortButton();

    expect(dialog()).toBeInstanceOf(HTMLElement);
    expect(abort.disabled).toBe(false);
    expect(abort.closest('[aria-hidden="true"]')).toBeNull();
    expect(abort.closest('[inert]')).toBeNull();
    // The workspace behind the dialog is hidden; the bar is the exception.
    expect(host.querySelector('main')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('main')?.hasAttribute('inert')).toBe(false);

    await act(async () => abort.click());

    expect(stopJob).toHaveBeenCalledTimes(1);
    // Aborting neither answers the question nor closes it.
    expect(settled).toBe(false);
    expect(dialog()).toBeInstanceOf(HTMLElement);
  });

  it('paints under the Live Motion bar and makes room for it', async () => {
    await act(async () => {
      void open();
    });
    const bar = host.querySelector<HTMLElement>('section[aria-label="Live Motion"]');

    // The backdrop is the shared .lf-dialog-backdrop: --lf-z-dialog, padded by
    // the height the bar publishes (use-live-motion-inset.ts).
    expect(dialog().className).toBe('lf-dialog-backdrop');
    expect(Number(bar?.style.zIndex)).toBeGreaterThan(tokenZIndex('--lf-z-dialog'));
    expect(document.documentElement.style.getPropertyValue('--lf-live-motion-inset')).not.toBe('');
  });

  it('does not suspend the page: timers and job progress carry on behind it', async () => {
    vi.useFakeTimers();
    try {
      let settled = false;
      await act(async () => {
        void open().then(() => {
          settled = true;
        });
      });
      const ticked = vi.fn();
      setTimeout(ticked, 250);
      await act(async () => {
        vi.advanceTimersByTime(250);
        const streamer = useLaserStore.getState().streamer;
        if (streamer === null) throw new Error('streamer missing');
        useLaserStore.setState({ streamer: step(streamer).state });
      });

      // window.confirm would have held both until the box was dismissed.
      expect(ticked).toHaveBeenCalledTimes(1);
      expect(settled).toBe(false);
      expect(abortButton().disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
