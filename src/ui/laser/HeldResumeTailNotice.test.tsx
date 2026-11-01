// ADR-684: the machine rail says grblHAL may still hold a paused move and
// offers a soft reset, until a reset or any motion retires the warning.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseStatusReport } from '../../core/controllers/grbl/status-parser';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { HeldResumeTailNotice } from './HeldResumeTailNotice';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function heldAt(x: number, report: string, sessionEpoch = 4): void {
  act(() =>
    useLaserStore.setState({
      connection: { kind: 'connected' },
      controllerSessionEpoch: 4,
      statusReport: parseStatusReport(report),
      heldResumeTail: { sessionEpoch, machinePosition: { x, y: 0, z: 0 } },
    }),
  );
}

beforeEach(() => {
  useLaserStore.setState(initialLaserState());
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useLaserStore.setState(initialLaserState());
});

describe('HeldResumeTailNotice', () => {
  it('warns and offers a reset while the machine has not moved', () => {
    const onReset = vi.fn();
    heldAt(0.6, '<Idle|MPos:0.600,0.000,0.000|FS:0,0>');
    act(() => root.render(<HeldResumeTailNotice onReset={onReset} />));
    expect(host.textContent).toContain('grblHAL builds before 20260928');
    const button = host.querySelector('button');
    expect(button?.disabled).toBe(false);
    act(() => button?.click());
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('retires after motion or a new controller session', () => {
    heldAt(0.6, '<Idle|MPos:1.000,0.000,0.000|FS:0,0>');
    act(() => root.render(<HeldResumeTailNotice onReset={() => undefined} />));
    expect(host.textContent).toBe('');
    heldAt(0.6, '<Idle|MPos:0.600,0.000,0.000|FS:0,0>', 3);
    act(() => root.render(<HeldResumeTailNotice onReset={() => undefined} />));
    expect(host.textContent).toBe('');
  });
});
