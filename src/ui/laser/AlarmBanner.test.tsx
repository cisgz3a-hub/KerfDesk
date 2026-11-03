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
    const { host, props } = await render({ code: 2, resetRequired: true });
    expect(buttons(host)).toEqual(['Reset (Ctrl-X)']);
    expect(host.textContent).toContain('accepts only a soft reset');
    await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
    expect(props.onReset).toHaveBeenCalledOnce();
  });

  // UX audit U5-P3-2: the alarm's own physical step comes before the reset; a
  // reset with the E-stop still pressed only raises the alarm again.
  it.each([
    [1, 'grbl-v1.1', 'move it off the limit switch'],
    [10, 'grblhal', 'Release the E-stop'],
    // A banner-less grblHAL board runs on the stock driver; stock GRBL's own
    // alarm 10 is never critical.
    [10, 'grbl-v1.1', 'Release the E-stop'],
    [13, 'fluidnc', 'Release the E-stop'],
  ] as const)('ALARM:%i on %s names its own step before Reset', async (code, kind, step) => {
    const { host } = await render({ code, controllerKind: kind, resetRequired: true });
    expect(buttons(host)).toEqual(['Reset (Ctrl-X)']);
    const text = host.textContent ?? '';
    expect(text).toContain(step);
    expect(text.indexOf(step)).toBeLessThan(text.indexOf('Then press Reset (Ctrl-X)'));
  });

  // UX audit U5-P2-1: no ALARM:N was seen, so the lock predates the connection.
  it('says a lock from before the connection needs a reset, and nothing about Unlock first', async () => {
    const { host } = await render({ code: null, resetRequired: true });
    expect(buttons(host)).toEqual(['Reset (Ctrl-X)']);
    expect(host.textContent).toContain('Controller needs a reset');
    expect(host.textContent).toContain('before KerfDesk connected');
    expect(host.textContent).toContain('Release the E-stop or move the head off the switch');
    expect(host.textContent).not.toContain('until the machine is homed or unlocked');
  });

  // Controller audit A-7 (ADR-375): stock GRBL refused a `$HX` with error:3 and
  // stayed in its homing state; it reports Home, not Alarm, until the reset.
  it('offers only Reset, and says why, while stock GRBL stays in its homing state', async () => {
    const { host, props } = await render({ code: null, resetRequired: 'homing-state' });
    expect(buttons(host)).toEqual(['Reset (Ctrl-X)']);
    expect(host.textContent).toContain('Controller is stuck in its homing state');
    expect(host.textContent).toContain('$HX');
    expect(host.textContent).not.toContain('critical event');
    expect(host.textContent).not.toContain('until the machine is homed or unlocked');
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
