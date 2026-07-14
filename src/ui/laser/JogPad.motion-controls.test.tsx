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

const originalJog = useLaserStore.getState().jog;
const originalCancelJog = useLaserStore.getState().cancelJog;
const originalCapabilities = useLaserStore.getState().capabilities;

function buttonByLabel(host: HTMLElement, label: string): HTMLButtonElement | null {
  return (
    [...host.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === label,
    ) ?? null
  );
}

async function renderJogPad(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
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

afterEach(() => {
  useLaserStore.setState({
    jog: originalJog,
    cancelJog: originalCancelJog,
    capabilities: originalCapabilities,
    statusReport: null,
    wcoCache: null,
  });
  useStore.setState({ project: createProject() });
  useJogControlPreferences.setState({
    stepMm: DEFAULT_JOG_STEP_MM,
    requestedFeedMmPerMin: DEFAULT_JOG_FEED_MM_PER_MIN,
  });
});

describe('JogPad motion controls', () => {
  it('uses the selected XY jog speed and clamps presets to the device maximum', async () => {
    const jog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog });
    useStore.getState().updateDeviceProfile({ maxFeed: 2000 });
    const { host, unmount } = await renderJogPad();
    const speed = host.querySelector<HTMLSelectElement>('select[aria-label="Jog speed"]');
    if (speed === null) throw new Error('jog speed select missing');
    expect(speed.value).toBe('2000');
    expect([...speed.options].map((option) => option.value)).toEqual([
      '100',
      '500',
      '1000',
      '2000',
    ]);
    await act(async () => {
      speed.value = '1000';
      speed.dispatchEvent(new Event('change', { bubbles: true }));
      buttonByLabel(host, 'Jog +X 10 mm')?.click();
    });
    expect(jog).toHaveBeenCalledWith({ dx: 10, feed: 1000 });
    await unmount();
  });

  it('supports diagonal step jogging with both machine axes', async () => {
    const jog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog });
    useStore.getState().updateDeviceProfile({ maxFeed: 6000 });
    const { host, unmount } = await renderJogPad();
    const upRight = buttonByLabel(host, 'Jog +X +Y 10 mm');
    if (upRight === null) throw new Error('diagonal jog button missing');
    await act(async () => upRight.click());
    expect(jog).toHaveBeenCalledWith({ dx: 10, dy: 10, feed: 3000 });
    await unmount();
  });

  it('does not jog the machine on bare arrow keys — they nudge the canvas object (F104)', async () => {
    const jog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog });
    useStore.getState().updateDeviceProfile({ origin: 'rear-left', maxFeed: 6000 });
    const { unmount } = await renderJogPad();
    await act(async () => {
      for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      }
    });
    expect(jog).not.toHaveBeenCalled();
    await unmount();
  });

  it('holds toward the machine boundary and cancels on pointer release', async () => {
    vi.useFakeTimers();
    const jog = vi.fn(async () => undefined);
    const cancelJog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog, cancelJog });
    useStore.getState().updateDeviceProfile({ bedWidth: 400, maxFeed: 6000 });
    const { host, unmount } = await renderJogPad();
    try {
      const right = buttonByLabel(host, 'Jog +X 10 mm');
      if (right === null) throw new Error('right jog button missing');
      await startHold(right);
      expect(jog).toHaveBeenCalledWith({ dx: 400, feed: 3000 });
      await act(async () => {
        right.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
      });
      expect(cancelJog).toHaveBeenCalledTimes(1);
    } finally {
      await unmount();
      vi.useRealTimers();
    }
  });

  it('does not start a continuous jog on firmware without a jog-cancel (holding steps once)', async () => {
    // F101: a bed-length continuous jog is unstoppable on Marlin/Smoothieware
    // (realtime.jogCancel === null → capabilities.jogCancel false). Holding must
    // NOT dispatch it; the gesture degrades to a single step so release cannot
    // strand the head mid-traverse.
    vi.useFakeTimers();
    const jog = vi.fn(async () => undefined);
    const cancelJog = vi.fn(async () => undefined);
    useLaserStore.setState({
      jog,
      cancelJog,
      capabilities: { ...originalCapabilities, jogCancel: false },
    });
    useStore.getState().updateDeviceProfile({ bedWidth: 400, maxFeed: 6000 });
    const { host, unmount } = await renderJogPad();
    try {
      const right = buttonByLabel(host, 'Jog +X 10 mm');
      if (right === null) throw new Error('right jog button missing');
      await startHold(right);
      // No continuous (bed-length) jog was dispatched while held.
      expect(jog).not.toHaveBeenCalled();
      await act(async () => {
        right.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
      });
      // Release performs a single step, and no phantom cancel is issued.
      expect(jog).toHaveBeenCalledTimes(1);
      expect(jog).toHaveBeenCalledWith({ dx: 10, feed: 3000 });
      expect(cancelJog).not.toHaveBeenCalled();
    } finally {
      await unmount();
      vi.useRealTimers();
    }
  });

  it('cancels an active hold when the app window loses focus', async () => {
    vi.useFakeTimers();
    const jog = vi.fn(async () => undefined);
    const cancelJog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog, cancelJog });
    const { host, unmount } = await renderJogPad();
    try {
      const right = buttonByLabel(host, 'Jog +X 10 mm');
      if (right === null) throw new Error('right jog button missing');
      await startHold(right);
      await act(async () => window.dispatchEvent(new Event('blur')));
      expect(jog).toHaveBeenCalledTimes(1);
      expect(cancelJog).toHaveBeenCalledTimes(1);
    } finally {
      await unmount();
      vi.useRealTimers();
    }
  });

  it('cancels an active hold when the jog panel unmounts', async () => {
    vi.useFakeTimers();
    const jog = vi.fn(async () => undefined);
    const cancelJog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog, cancelJog });
    const { host, unmount } = await renderJogPad();
    try {
      const right = buttonByLabel(host, 'Jog +X 10 mm');
      if (right === null) throw new Error('right jog button missing');
      await startHold(right);
      await unmount();
      expect(jog).toHaveBeenCalledTimes(1);
      expect(cancelJog).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

async function startHold(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    await vi.advanceTimersByTimeAsync(250);
  });
}
