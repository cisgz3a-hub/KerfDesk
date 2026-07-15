import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JOB_CHECKPOINT_STORAGE_KEY } from '../state/job-checkpoint-storage';
import { useLaserStore } from '../state/laser-store';
import { SafetyNoticeBanner } from './SafetyNoticeBanner';

const originalWakeController = useLaserStore.getState().wakeController;

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  useLaserStore.setState({
    safetyNotice: null,
    connection: { kind: 'disconnected' },
    statusReport: null,
    controllerOperation: null,
    wakeController: originalWakeController,
  });
  localStorage.clear();
  vi.restoreAllMocks();
});

async function renderBanner(props?: {
  readonly onReconnect?: () => void;
  readonly reconnectDisabled?: boolean;
}): Promise<{ host: HTMLElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root!: Root;
  await act(async () => {
    root = createRoot(host);
    root.render(<SafetyNoticeBanner {...props} />);
  });
  return { host, root };
}

describe('SafetyNoticeBanner', () => {
  it('renders nothing when there is no safety notice', async () => {
    useLaserStore.setState({ safetyNotice: null });
    const { host, root } = await renderBanner();
    try {
      expect(host.querySelector('[role="alert"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('acknowledges the safety warning without clearing the job checkpoint', async () => {
    localStorage.setItem(JOB_CHECKPOINT_STORAGE_KEY, 'retained-checkpoint');
    useLaserStore.setState({
      safetyNotice: {
        kind: 'disconnect-during-job',
        message: 'USB lost mid-job. Use physical E-stop.',
      },
    });
    const { host, root } = await renderBanner();
    try {
      const alert = host.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('USB lost mid-job. Use physical E-stop.');

      const dismiss = [...host.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('I made the machine safe'),
      );
      expect(dismiss).toBeInstanceOf(HTMLButtonElement);
      await act(async () => dismiss?.click());

      // Dismiss acknowledges the warning: store cleared AND banner gone.
      expect(useLaserStore.getState().safetyNotice).toBeNull();
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(localStorage.getItem(JOB_CHECKPOINT_STORAGE_KEY)).toBe('retained-checkpoint');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('offers reconnect, never Ctrl-X recovery, when the USB transport is gone', async () => {
    const reconnect = vi.fn();
    const wake = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'disconnected' },
      wakeController: wake,
      safetyNotice: {
        kind: 'disconnect-during-job',
        message: 'USB lost mid-job. Use physical E-stop.',
      },
    });
    const { host, root } = await renderBanner({ onReconnect: reconnect });
    try {
      const labels = [...host.querySelectorAll('button')].map((button) => button.textContent);
      expect(labels).toContain('Reconnect controller…');
      expect(labels).not.toContain('Recover controller');
      expect(labels.some((label) => label?.includes('Reset controller'))).toBe(false);

      await act(async () => {
        [...host.querySelectorAll('button')]
          .find((button) => button.textContent === 'Reconnect controller…')
          ?.click();
      });

      expect(reconnect).toHaveBeenCalledTimes(1);
      expect(wake).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('labels Ctrl-X explicitly and only offers it to a connected sleeping controller', async () => {
    const wake = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: {
        state: 'Sleep',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
      wakeController: wake,
      safetyNotice: { kind: 'write-failed', action: 'wake', message: 'Reset write failed.' },
    });
    const { host, root } = await renderBanner({ onReconnect: vi.fn() });
    try {
      const reset = [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Reset controller (does not resume job)'),
      );
      expect(reset).toBeInstanceOf(HTMLButtonElement);

      await act(async () => {
        reset?.click();
        await Promise.resolve();
      });

      expect(wake).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('uses a specific write-failure title instead of the removed generic guard copy', async () => {
    useLaserStore.setState({
      safetyNotice: {
        kind: 'write-failed',
        action: 'jog',
        message: 'Jog write failed.',
      },
    });
    const { host, root } = await renderBanner();
    try {
      const alert = host.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('Controller write failed');
      expect(alert?.textContent).not.toContain('Command may not have sent');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
