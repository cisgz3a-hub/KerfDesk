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
  it('keeps Disconnect and Forget Device as separate explicit actions', async () => {
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
    const forget = buttons.find((button) => button.textContent === 'Forget Device');
    expect(disconnect).toBeDefined();
    expect(forget).toBeDefined();
    await act(async () => disconnect?.click());
    expect(onDisconnect).toHaveBeenCalledOnce();
    expect(onForget).not.toHaveBeenCalled();
    await act(async () => forget?.click());
    expect(onForget).toHaveBeenCalledOnce();
  });
});
