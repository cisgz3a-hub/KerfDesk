// Controller audit 2026-09-25 GP-2 / HF-3 and CG-4. After a critical event the
// banner offers only Reset (Ctrl-X); a halted Smoothieware board, which refuses
// its Home sequence until M999, is offered Unlock first.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlarmBanner } from './AlarmBanner';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

async function render(overrides: Partial<Parameters<typeof AlarmBanner>[0]> = {}): Promise<{
  readonly host: HTMLDivElement;
  readonly props: Parameters<typeof AlarmBanner>[0];
}> {
  const props: Parameters<typeof AlarmBanner>[0] = {
    code: 1,
    controllerKind: 'grbl-v1.1',
    homingEnabled: true,
    homeFromAlarm: true,
    canUnlock: true,
    resetRequired: false,
    onHome: vi.fn(),
    onConfigureHoming: vi.fn(),
    onUnlock: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(<AlarmBanner {...props} />);
  });
  return { host, props };
}

function buttons(container: HTMLElement): string[] {
  return [...container.querySelectorAll('button')].map((button) => button.textContent ?? '');
}

describe('AlarmBanner', () => {
  it('offers only Reset while the controller requires a soft reset', async () => {
    const { host, props } = await render({ resetRequired: true });
    expect(buttons(host)).toEqual(['Reset (Ctrl-X)']);
    expect(host.textContent).toContain('accepts only a soft reset');
    await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
    expect(props.onReset).toHaveBeenCalledOnce();
  });

  it('offers Home and Unlock for an ordinary alarm', async () => {
    const { host } = await render({ code: 9 });
    expect(buttons(host)).toEqual(['Home ($H)', '$X — Unlock']);
  });

  it('offers Unlock first on a controller that cannot home while halted', async () => {
    const { host } = await render({ code: null, homeFromAlarm: false });
    expect(buttons(host)).toEqual(['$X — Unlock']);
    expect(host.textContent).toContain('cannot home while halted');
  });
});
