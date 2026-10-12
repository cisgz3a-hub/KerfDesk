import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionBar } from './ConnectionBar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Props = Parameters<typeof ConnectionBar>[0];
const baseProps: Props = {
  connection: { kind: 'connected' },
  machineNoun: 'router',
  onConnect: () => undefined,
  onDisconnect: () => undefined,
  onForget: () => undefined,
  disabled: false,
  qualification: { kind: 'failed', epoch: 4, message: 'The settings response was empty.' },
};

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

async function render(props: Partial<Props>): Promise<HTMLDivElement> {
  if (host === null) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  await act(async () => root?.render(<ConnectionBar {...baseProps} {...props} />));
  return host;
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(
    (button) => button.textContent === label || button.getAttribute('aria-label') === label,
  );
}

describe('ConnectionBar controller information recovery', () => {
  it('dismisses and reopens the notification without invoking a controller action', async () => {
    const onRetry = vi.fn();
    const onReconnect = vi.fn();
    const container = await render({
      reconnectRecommended: true,
      onRetryQualification: onRetry,
      onReconnectQualification: onReconnect,
    });
    const trigger = findButton(container, 'More connection options');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    const dismiss = container.querySelector<HTMLButtonElement>(
      '[aria-label="Dismiss controller notification"]',
    );
    await act(async () => dismiss?.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onRetry).not.toHaveBeenCalled();
    expect(onReconnect).not.toHaveBeenCalled();

    await act(async () => trigger?.click());
    await act(async () => findButton(document.body, 'Controller info')?.click());
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Dismiss controller notification',
    );
    const retry = findButton(container, 'Retry reading controller settings');
    await act(async () => {
      retry?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('focuses the existing toast when Controller info is selected while it is visible', async () => {
    const container = await render({});
    await act(async () => findButton(container, 'More connection options')?.click());
    await act(async () => findButton(document.body, 'Controller info')?.click());
    expect(document.activeElement).toBe(findButton(container, 'Dismiss controller notification'));
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('keeps a dismissed failure hidden through status updates and opens a new session failure', async () => {
    const container = await render({});
    await act(async () => findButton(container, 'Dismiss controller notification')?.click());
    await render({ qualificationReadBlockReason: 'Controller is in Alarm.' });
    expect(container.querySelector('[role="alert"]')).toBeNull();

    await render({
      qualification: { kind: 'failed', epoch: 5, message: 'The settings response was empty.' },
    });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();

    await render({ qualification: { kind: 'qualified', epoch: 5, settings: 'verified' } });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(findButton(container, 'Controller info')).toBeUndefined();
  });

  it('opens a changed failure and resets dismissal after a retry or disconnect', async () => {
    const container = await render({});
    const dismiss = async () => {
      await act(async () => findButton(container, 'Dismiss controller notification')?.click());
      expect(container.querySelector('[role="alert"]')).toBeNull();
    };
    await dismiss();
    await render({ qualification: { kind: 'failed', epoch: 4, message: 'A new timeout.' } });
    expect(container.textContent).toContain('A new timeout.');
    await dismiss();
    await render({ qualification: { kind: 'qualifying', epoch: 4, phase: 'settings-read' } });
    await render({ qualification: { kind: 'failed', epoch: 4, message: 'A new timeout.' } });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await dismiss();
    await render({ connection: { kind: 'disconnected' } });
    await render({ qualification: { kind: 'failed', epoch: 4, message: 'A new timeout.' } });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('disables Retry until the authoritative read readiness clears', async () => {
    const onRetry = vi.fn();
    const reason =
      'Wait for the previous controller write and acknowledgement before reading machine settings.';
    const container = await render({
      qualificationReadBlockReason: reason,
      onRetryQualification: onRetry,
    });
    const retry = findButton(container, 'Retry reading controller settings');
    expect(retry?.disabled).toBe(true);
    expect(container.textContent).toContain(`Waiting to retry: ${reason}`);
    await act(async () => retry?.click());
    expect(onRetry).not.toHaveBeenCalled();

    await render({ qualificationReadBlockReason: null, onRetryQualification: onRetry });
    expect(retry?.disabled).toBe(false);
    expect(container.textContent).not.toContain('Waiting to retry:');
    await act(async () => retry?.click());
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('does not enable Retry without a readiness result', async () => {
    const onRetry = vi.fn();
    const container = await render({ onRetryQualification: onRetry });
    const retry = findButton(container, 'Retry reading controller settings');
    expect(retry?.disabled).toBe(true);
    await act(async () => retry?.click());
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('offers reconnect only when the current transport needs recovery', async () => {
    const onReconnect = vi.fn();
    const container = await render({
      reconnectRecommended: true,
      onReconnectQualification: onReconnect,
    });
    expect(container.textContent).toContain('Controller connection needs recovery');
    const reconnect = findButton(container, 'Reconnect controller');
    expect(reconnect?.title).toContain('ends any paused job');
    await act(async () => reconnect?.click());
    expect(onReconnect).toHaveBeenCalledOnce();

    await render({ reconnectRecommended: false, onReconnectQualification: onReconnect });
    expect(container.textContent).toContain('Controller information unavailable');
    expect(findButton(container, 'Reconnect controller')).toBeUndefined();
  });

  it('shows the actual waiting state after reset and hides stale info when disconnected', async () => {
    const container = await render({
      qualification: { kind: 'qualifying', epoch: 4, phase: 'reset-cleanup' },
      qualificationReadBlockReason:
        'Controller is in Alarm. Unlock or Home before reading settings.',
    });
    expect(
      container.querySelector('[role="status"]:not(.lf-connection-status-live)')?.textContent,
    ).toContain('Controller is in Alarm');
    expect(container.textContent).not.toContain('Waiting for fresh Idle');
    expect(findButton(container, 'Reconnect controller')).toBeUndefined();

    await render({
      qualification: { kind: 'qualifying', epoch: 4, phase: 'controller-response' },
      qualificationReadBlockReason:
        'Controller is in Alarm. Unlock or Home before reading settings.',
    });
    expect(container.textContent).toContain('Waiting to read controller settings…');
    expect(container.textContent).not.toContain('Waiting for controller response…');

    await render({ connection: { kind: 'disconnected' } });
    expect(container.textContent).not.toContain('Controller information unavailable');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows an active settings read without its own busy reason', async () => {
    const container = await render({
      qualification: { kind: 'qualifying', epoch: 4, phase: 'settings-read' },
      qualificationReadBlockReason: 'Machine settings are already being read.',
    });
    expect(
      container.querySelector('[role="status"]:not(.lf-connection-status-live)')?.textContent,
    ).toBe('Reading controller settings…');
  });
});
