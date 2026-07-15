import { act } from 'react';
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
  it('keeps Disconnect and Forget Controller as separate explicit actions', async () => {
    const onDisconnect = vi.fn();
    const onForget = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    await act(async () => {
      root = createRoot(host);
      root.render(
        <ConnectionBar
          connection={{ kind: 'connected' }}
          machineNoun="laser"
          onConnect={() => undefined}
          onDisconnect={onDisconnect}
          onForget={onForget}
          disabled={false}
        />,
      );
    });
    cleanup = async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    };

    const buttons = [...host.querySelectorAll('button')];
    const disconnect = buttons.find((button) => button.textContent === 'Disconnect');
    const forget = buttons.find((button) => button.textContent === 'Forget Controller');
    expect(disconnect).toBeDefined();
    expect(forget).toBeDefined();
    await act(async () => disconnect?.click());
    expect(onDisconnect).toHaveBeenCalledOnce();
    expect(onForget).not.toHaveBeenCalled();
    await act(async () => forget?.click());
    expect(onForget).toHaveBeenCalledOnce();
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
