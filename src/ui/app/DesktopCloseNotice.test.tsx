import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { DesktopCloseNotice } from './DesktopCloseNotice';
import { desktopCloseController } from './desktop-close-runtime';

const initial = useLaserStore.getState();
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterEach(() => {
  desktopCloseController.keepOpen();
  useLaserStore.setState(initial);
  vi.unstubAllGlobals();
});

describe('desktop close recovery notice', () => {
  it('shows a nonmodal pending stop with a working Keep app open control', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    let finish: () => void = () => undefined;
    const stop = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    useLaserStore.setState({ streamer: step(createStreamer('G1 X1')).state, stopJob: stop });
    const pending = desktopCloseController.prepare(1);
    await act(async () => root.render(<DesktopCloseNotice />));
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Sending Abort');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    const button = host.querySelector('button');
    expect(button?.textContent).toBe('Keep app open');
    await act(async () => button?.click());
    expect(await pending).toEqual({ status: 'cancelled' });
    expect(host.textContent).toBe('');
    finish();
    await act(async () => root.unmount());
  });

  it('keeps an unconfirmed stop warning readable until explicit acknowledgement', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    useLaserStore.setState({
      streamer: null,
      safetyNotice: {
        kind: 'disconnect-stop-unconfirmed',
        message: 'Buffered motion may be active.',
      },
    });
    const pending = desktopCloseController.prepare(2);
    await act(async () => root.render(<DesktopCloseNotice />));
    expect(host.textContent).toContain('Buffered motion may be active.');
    const acknowledge = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Acknowledge'),
    );
    expect(acknowledge).toBeDefined();
    await act(async () => acknowledge?.click());
    expect(await pending).toMatchObject({ status: 'ready' });
    // A close acknowledgement does not clear or relabel the underlying notice.
    expect(useLaserStore.getState().safetyNotice?.kind).toBe('disconnect-stop-unconfirmed');
    await act(async () => root.unmount());
  });
});
