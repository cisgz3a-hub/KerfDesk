import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from '../state/laser-store';
import { SafetyNoticeBanner } from './SafetyNoticeBanner';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  useLaserStore.setState({ safetyNotice: null });
});

async function renderBanner(): Promise<{ host: HTMLElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root!: Root;
  await act(async () => {
    root = createRoot(host);
    root.render(<SafetyNoticeBanner />);
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

  it('shows the notice message and clears it when dismissed', async () => {
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
        b.textContent?.includes('Dismiss'),
      );
      expect(dismiss).toBeInstanceOf(HTMLButtonElement);
      await act(async () => dismiss?.click());

      // Dismiss acknowledges the warning: store cleared AND banner gone.
      expect(useLaserStore.getState().safetyNotice).toBeNull();
      expect(host.querySelector('[role="alert"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('offers a real disconnect for controller ownership loss instead of a soft reset', async () => {
    const originalDisconnect = useLaserStore.getState().disconnect;
    const disconnect = vi.fn(async () => undefined);
    useLaserStore.setState({
      disconnect,
      safetyNotice: {
        kind: 'controller-ownership',
        message: 'Controller reply ownership was lost.',
      },
    });
    const { host, root } = await renderBanner();
    try {
      const action = [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Disconnect controller'),
      );
      expect(action).toBeInstanceOf(HTMLButtonElement);
      await act(async () => action?.click());
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(host.textContent).not.toContain('Recover controller');
    } finally {
      await act(async () => useLaserStore.setState({ disconnect: originalDisconnect }));
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
