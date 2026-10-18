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

/** The one controller state that announces itself unasked (ADR-607). */
const silent = { controllerStoppedResponding: true } satisfies Partial<Props>;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  vi.useRealTimers();
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

function briefNotice(): HTMLElement | null {
  return document.querySelector('[role="group"][aria-label="Controller notification"]');
}

function details(): HTMLElement | null {
  return document.querySelector('[role="dialog"][aria-label="Controller information"]');
}

// Controller info opens from the connection menu, as it does when no brief
// notice is shown.
async function openDetails(): Promise<void> {
  await act(async () => findButton(document.body, 'More connection options')?.click());
  await act(async () => findButton(document.body, 'Controller info')?.click());
  expect(details()).not.toBeNull();
}

async function openFromBrief(): Promise<void> {
  const button = briefNotice()?.querySelector('button');
  expect(button).not.toBeNull();
  await act(async () => button?.click());
  expect(details()).not.toBeNull();
}

async function expireNotice(): Promise<void> {
  await act(async () => vi.advanceTimersByTime(6000));
  expect(briefNotice()).toBeNull();
}

describe('ConnectionBar controller information recovery', () => {
  it('dismisses the brief explicitly and does not revive it when reconnect becomes available', async () => {
    await render({ ...silent, reconnectRecommended: false });
    await openFromBrief();
    await act(async () => findButton(document.body, 'Dismiss controller notification')?.click());
    expect(briefNotice()).toBeNull();
    await render({ ...silent, reconnectRecommended: true });
    expect(briefNotice()).toBeNull();
  });

  it('keeps a failed read quiet while the controller answers, and announces when it stops', async () => {
    await render({ reconnectRecommended: true });
    expect(briefNotice()).toBeNull();
    expect(details()).toBeNull();
    await render({ ...silent, reconnectRecommended: true });
    expect(briefNotice()?.textContent).toContain('Controller is not responding');
    expect(details()).toBeNull();
  });

  it.each(['controller-response', 'reset-cleanup', 'settings-read'] as const)(
    'reads controller settings after a reset without a notification: %s',
    async (phase) => {
      await render({ ...silent, qualification: { kind: 'qualifying', epoch: 4, phase } });
      expect(briefNotice()).toBeNull();
      expect(details()).toBeNull();
    },
  );

  it('closes requested details before opening the connection menu', async () => {
    const container = await render({});
    await openDetails();
    await act(async () => findButton(container, 'More connection options')?.click());
    expect(details()).toBeNull();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });

  it.each([
    { qualification: { kind: 'qualifying', epoch: 4, phase: 'settings-read' } },
    { qualification: { kind: 'qualified', epoch: 4, settings: 'verified' } },
    { connection: { kind: 'disconnected' } },
  ] satisfies Partial<Props>[])(
    'preserves focus when replacing a focused brief: %j',
    async (patch) => {
      const container = await render(silent);
      await act(async () => briefNotice()?.querySelector('button')?.focus());
      await render(patch);
      expect(document.activeElement).toBe(findButton(container, 'More connection options'));
    },
  );

  it('keeps an empty announcement region mounted before qualification begins', async () => {
    const container = await render({ connection: { kind: 'disconnected' } });
    const region = container.querySelector('[aria-label="Controller updates"]');
    expect(region?.textContent).toBe('');
    await render({});
    expect(region?.textContent).toBe('');
    await render(silent);
    expect(container.querySelector('[aria-label="Controller updates"]')).toBe(region);
    expect(region?.textContent).toContain('Controller is not responding');
  });

  it('preserves the next control when keyboard focus leaves requested details', async () => {
    const container = await render({});
    await openDetails();
    const next = findButton(container, 'Disconnect');
    await act(async () => next?.focus());
    expect(details()).toBeNull();
    expect(document.activeElement).toBe(next);
  });

  it('preserves an outside pointer target when requested details close', async () => {
    const container = await render({});
    await openDetails();
    const next = findButton(container, 'Disconnect');
    await act(async () => {
      next?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      next?.focus();
    });
    expect(details()).toBeNull();
    expect(document.activeElement).toBe(next);
  });

  it.each([
    { qualification: { kind: 'qualifying', epoch: 4, phase: 'settings-read' } },
    { qualification: { kind: 'qualified', epoch: 4, settings: 'verified' } },
    { connection: { kind: 'disconnected' } },
  ] satisfies Partial<Props>[])(
    'returns focus to connection options when a state transition removes focused details: %j',
    async (patch) => {
      const container = await render({});
      await openDetails();
      expect(details()?.contains(document.activeElement)).toBe(true);
      await render(patch);
      expect(details()).toBeNull();
      expect(document.activeElement).toBe(findButton(container, 'More connection options'));
    },
  );

  it('does not take outside focus when a later qualification update removes the notice', async () => {
    const container = await render({});
    await openDetails();
    const next = findButton(container, 'Disconnect');
    await act(async () => next?.focus());
    await render({ qualification: { kind: 'qualified', epoch: 4, settings: 'verified' } });
    expect(details()).toBeNull();
    expect(document.activeElement).toBe(next);
  });

  it('dismisses and reopens the notification without invoking a controller action', async () => {
    const onRetry = vi.fn();
    const onReconnect = vi.fn();
    const container = await render({
      ...silent,
      reconnectRecommended: true,
      onRetryQualification: onRetry,
      onReconnectQualification: onReconnect,
    });
    const trigger = findButton(container, 'More connection options');
    expect(briefNotice()).not.toBeNull();
    expect(details()).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await openFromBrief();
    const dismiss = document.querySelector<HTMLButtonElement>(
      '[aria-label="Dismiss controller notification"]',
    );
    await act(async () => dismiss?.click());
    expect(details()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onRetry).not.toHaveBeenCalled();
    expect(onReconnect).not.toHaveBeenCalled();

    await act(async () => trigger?.click());
    await act(async () => findButton(document.body, 'Controller info')?.click());
    expect(details()).not.toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Dismiss controller notification',
    );
    const retry = findButton(document.body, 'Retry reading controller settings');
    await act(async () => {
      retry?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(details()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps controller info reachable from the menu after the brief notice expires', async () => {
    vi.useFakeTimers();
    const container = await render(silent);
    await expireNotice();
    await act(async () => findButton(container, 'More connection options')?.click());
    await act(async () => findButton(document.body, 'Controller info')?.click());
    expect(document.activeElement).toBe(
      findButton(document.body, 'Dismiss controller notification'),
    );
    expect(details()).not.toBeNull();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('keeps an expired failure hidden through status updates and announces a new session failure', async () => {
    vi.useFakeTimers();
    const container = await render(silent);
    await expireNotice();
    await render({ ...silent, qualificationReadBlockReason: 'Controller is in Alarm.' });
    expect(briefNotice()).toBeNull();
    expect(details()).toBeNull();

    await render({
      ...silent,
      qualification: { kind: 'failed', epoch: 5, message: 'The settings response was empty.' },
    });
    expect(briefNotice()).not.toBeNull();
    expect(details()).toBeNull();

    await render({
      ...silent,
      qualification: { kind: 'qualified', epoch: 5, settings: 'verified' },
    });
    expect(briefNotice()).toBeNull();
    expect(details()).toBeNull();
    await act(async () => findButton(container, 'More connection options')?.click());
    expect(findButton(document.body, 'Controller info')).toBeUndefined();
  });

  it('announces a changed failure of a silent controller without opening details', async () => {
    vi.useFakeTimers();
    await render(silent);
    await expireNotice();
    await render({
      ...silent,
      qualification: { kind: 'failed', epoch: 4, message: 'A new timeout.' },
    });
    expect(briefNotice()?.querySelector('button')?.title).toContain('A new timeout.');
    expect(details()).toBeNull();
    await render({ connection: { kind: 'disconnected' } });
    expect(briefNotice()).toBeNull();
    await render({
      ...silent,
      qualification: { kind: 'failed', epoch: 4, message: 'A new timeout.' },
    });
    expect(briefNotice()).not.toBeNull();
    expect(details()).toBeNull();
  });

  it('disables Retry until the authoritative read readiness clears', async () => {
    const onRetry = vi.fn();
    const reason =
      'Wait for the previous controller write and acknowledgement before reading machine settings.';
    await render({
      qualificationReadBlockReason: reason,
      onRetryQualification: onRetry,
    });
    await openDetails();
    const retry = findButton(document.body, 'Retry reading controller settings');
    expect(retry?.disabled).toBe(true);
    expect(details()?.textContent).toContain(`Waiting to retry: ${reason}`);
    await act(async () => retry?.click());
    expect(onRetry).not.toHaveBeenCalled();

    await render({ qualificationReadBlockReason: null, onRetryQualification: onRetry });
    expect(retry?.disabled).toBe(false);
    expect(details()?.textContent).not.toContain('Waiting to retry:');
    await act(async () => retry?.click());
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('does not enable Retry without a readiness result', async () => {
    const onRetry = vi.fn();
    await render({ onRetryQualification: onRetry });
    await openDetails();
    const retry = findButton(document.body, 'Retry reading controller settings');
    expect(retry?.disabled).toBe(true);
    await act(async () => retry?.click());
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('offers reconnect only when the current transport needs recovery', async () => {
    const onReconnect = vi.fn();
    await render({
      reconnectRecommended: true,
      onReconnectQualification: onReconnect,
    });
    expect(briefNotice()).toBeNull();
    await openDetails();
    expect(details()?.textContent).toContain('Controller connection needs recovery');
    const reconnect = findButton(document.body, 'Reconnect controller');
    expect(reconnect?.title).toContain('ends any paused job');
    await act(async () => reconnect?.click());
    expect(onReconnect).toHaveBeenCalledOnce();

    await render({ reconnectRecommended: false, onReconnectQualification: onReconnect });
    expect(details()?.textContent).toContain('Controller information unavailable');
    expect(findButton(document.body, 'Reconnect controller')).toBeUndefined();
  });

  it('shows the actual waiting state after reset and hides stale info when disconnected', async () => {
    const container = await render({
      qualification: { kind: 'qualifying', epoch: 4, phase: 'reset-cleanup' },
      qualificationReadBlockReason:
        'Controller is in Alarm. Unlock or Home before reading settings.',
    });
    expect(briefNotice()).toBeNull();
    await openDetails();
    expect(details()?.textContent).toContain('Waiting to read controller settings…');
    expect(details()?.textContent).toContain('Controller is in Alarm');
    expect(container.textContent).not.toContain('Waiting for fresh Idle');
    expect(findButton(container, 'Reconnect controller')).toBeUndefined();

    await render({
      qualification: { kind: 'qualifying', epoch: 4, phase: 'controller-response' },
      qualificationReadBlockReason:
        'Controller is in Alarm. Unlock or Home before reading settings.',
    });
    expect(briefNotice()).toBeNull();
    await openDetails();
    expect(details()?.textContent).toContain('Waiting to read controller settings…');
    expect(details()?.textContent).not.toContain('Waiting for controller response…');

    await render({ connection: { kind: 'disconnected' } });
    expect(container.textContent).not.toContain('Controller information unavailable');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(briefNotice()).toBeNull();
    expect(details()).toBeNull();
  });

  it('shows an active settings read without its own busy reason', async () => {
    const container = await render({
      qualification: { kind: 'qualifying', epoch: 4, phase: 'settings-read' },
      qualificationReadBlockReason: 'Machine settings are already being read.',
    });
    expect(briefNotice()).toBeNull();
    expect(container.textContent).not.toContain('Machine settings are already being read.');
    await openDetails();
    expect(details()?.textContent).toContain('Reading controller settings…');
    expect(details()?.textContent).not.toContain('Machine settings are already being read.');
  });
});
