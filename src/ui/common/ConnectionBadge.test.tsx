import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectionBadge } from './ConnectionBadge';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

async function render(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<ConnectionBadge />);
  });
  if (root === null) throw new Error('root missing');
  return { host, root };
}

afterEach(() => {
  setOnline(true);
  document.body.innerHTML = '';
});

describe('ConnectionBadge', () => {
  it('renders nothing when online', async () => {
    setOnline(true);
    const { host } = await render();
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it('shows an Offline badge when offline', async () => {
    setOnline(false);
    const { host } = await render();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Offline');
  });

  it('reacts to the offline event', async () => {
    setOnline(true);
    const { host } = await render();
    expect(host.querySelector('[role="status"]')).toBeNull();
    await act(async () => {
      setOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Offline');
  });
});
