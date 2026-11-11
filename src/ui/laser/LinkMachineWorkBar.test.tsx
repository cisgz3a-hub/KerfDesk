// The Live Motion bar for a controller-link job (ADR-705 Amendment 3, code
// quality audit C2 D1-P2-5): absent while no link works; while one does, it
// names the work, keeps the job's warnings in view and its Abort sends the
// link's own stop. It stays reachable behind an open modal.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODAL_REACHABLE_ATTRIBUTE } from '../common/hide-outside-modal';
import { reportLinkMachineWork, resetLinkMachineWorkForTests } from '../state/link-machine-work';
import { LinkMachineWorkBar } from './LinkMachineWorkBar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<LinkMachineWorkBar />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetLinkMachineWorkForTests();
});

describe('LinkMachineWorkBar', () => {
  it('shows nothing while no link works', () => {
    expect(host.textContent).toBe('');
  });

  it('names the work, lists its warnings and aborts through the link', async () => {
    const abort = vi.fn(async () => undefined);
    act(() =>
      reportLinkMachineWork('ruida-network', {
        controller: 'Ruida',
        activity: 'running',
        advisories: ['Layer 1: runs past the bed.'],
        abort,
      }),
    );
    expect(host.textContent).toContain('Ruida is running the job');
    expect(host.textContent).toContain('Layer 1: runs past the bed.');
    const section = host.querySelector('section');
    expect(section?.hasAttribute(MODAL_REACHABLE_ATTRIBUTE)).toBe(true);
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'ABORT JOB');
    if (button === undefined) throw new Error('no ABORT JOB');
    await act(async () => button.click());
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('offers ABORT MOTION for a Frame', () => {
    act(() =>
      reportLinkMachineWork('moshi-usb', {
        controller: 'Moshiboard',
        activity: 'framing',
        advisories: [],
        abort: async () => undefined,
      }),
    );
    expect(host.textContent).toContain('Moshiboard is tracing the Frame (laser off)');
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'ABORT MOTION',
    ]);
  });
});
