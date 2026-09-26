import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionBar } from './ConnectionBar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe('ConnectionBar device permission actions', () => {
  it('keeps Disconnect on the card and Forget Controller in its menu', async () => {
    const onDisconnect = vi.fn();
    const onForget = vi.fn();
    const host = await renderBar({
      connection: { kind: 'connected' },
      onDisconnect,
      onForget,
    });

    const disconnect = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Disconnect',
    );
    expect(disconnect).toBeDefined();
    expect(menuItem('Forget Controller')).toBeUndefined();
    await act(async () => disconnect?.click());
    expect(onDisconnect).toHaveBeenCalledOnce();
    expect(onForget).not.toHaveBeenCalled();

    await openMenu(host);
    await act(async () => menuItem('Forget Controller')?.click());
    expect(onForget).toHaveBeenCalledOnce();
    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  // ADR-420: the everyday row holds one action; the port choice and the
  // automatic connection live in the menu.
  it('offers a different port and the automatic connection from the menu', async () => {
    const onChoosePort = vi.fn();
    const onAutoConnectChange = vi.fn();
    const onConnect = vi.fn();
    const host = await renderBar({
      connection: { kind: 'disconnected' },
      onConnect,
      onChoosePort,
      autoConnect: true,
      onAutoConnectChange,
    });

    expect(host.querySelector('[role="status"]')?.textContent).toBe('Not connected');
    const connect = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Connect',
    );
    await act(async () => connect?.click());
    expect(onConnect).toHaveBeenCalledOnce();

    await openMenu(host);
    expect(menuItem('Forget Controller')).toBeUndefined();
    const auto = menuItem('Connect automatically');
    expect(auto?.getAttribute('role')).toBe('menuitemcheckbox');
    expect(auto?.getAttribute('aria-checked')).toBe('true');
    await act(async () => auto?.click());
    expect(onAutoConnectChange).toHaveBeenCalledExactlyOnceWith(false);

    await openMenu(host);
    await act(async () => menuItem('Use a different port…')?.click());
    expect(onChoosePort).toHaveBeenCalledOnce();
  });

  it('says a port another program holds is busy', async () => {
    const host = await renderBar({
      connection: {
        kind: 'failed',
        error: 'Failed to execute open on SerialPort: Failed to open serial port.',
      },
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Couldn’t connect');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'The port is busy or unavailable',
    );
  });

  it('surfaces a failed qualification with an inline retry action', async () => {
    const onRetry = vi.fn();
    const onReconnect = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    await act(async () => {
      root = createRoot(host);
      root.render(
        <ConnectionBar
          connection={{ kind: 'connected' }}
          machineNoun="router"
          onConnect={() => undefined}
          onDisconnect={() => undefined}
          onForget={() => undefined}
          disabled={false}
          qualification={{
            kind: 'failed',
            epoch: 4,
            message: 'The settings response timed out.',
          }}
          onRetryQualification={onRetry}
          onReconnectQualification={onReconnect}
        />,
      );
    });
    cleanup = async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    };

    expect(host.textContent).toContain('Controller qualification failed');
    expect(host.textContent).toContain('The settings response timed out');
    // A recoverable failure wears the shared warning banner instead of bare
    // red text, and its actions use the standard button chrome.
    const banner = host.querySelector('[role="alert"]');
    expect(banner?.className).toContain('lf-banner--warning');
    expect(banner?.querySelector('button')?.className).toContain('lf-btn');
    const retry = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Retry reading controller settings'),
    );
    await act(async () => retry?.click());
    expect(onRetry).toHaveBeenCalledOnce();
    const reconnect = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Reconnect controller',
    );
    await act(async () => reconnect?.click());
    expect(onReconnect).toHaveBeenCalledOnce();
  });
});

async function renderBar(
  overrides: Partial<ComponentProps<typeof ConnectionBar>>,
): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <ConnectionBar
        connection={{ kind: 'disconnected' }}
        machineNoun="laser"
        onConnect={() => undefined}
        onDisconnect={() => undefined}
        onForget={() => undefined}
        disabled={false}
        {...overrides}
      />,
    );
  });
  cleanup = async () => {
    if (root !== null) await act(async () => root?.unmount());
    host.remove();
  };
  return host;
}

async function openMenu(host: HTMLElement): Promise<void> {
  const more = host.querySelector<HTMLButtonElement>(
    'button[aria-label="More connection options"]',
  );
  await act(async () => more?.click());
}

// The menu is anchored in a popover, which may render outside the card.
function menuItem(label: string): HTMLButtonElement | undefined {
  return [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemcheckbox"]'),
  ].find((item) => item.querySelector('span')?.textContent === label);
}
