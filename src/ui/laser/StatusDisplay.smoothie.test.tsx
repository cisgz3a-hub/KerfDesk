// Controller audit SM-9: the Laser window status row read Smoothieware's
// resting `F:` (the requested feed) as a live feed, and showed S 0 while
// running because Smoothieware reports `|L:<power %>|S:<S>` rather than GRBL's
// `FS:` (Kernel.cpp L206-L302). The row now shows only live values.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { smoothiewareDriver } from '../../core/controllers';
import { useLaserStore } from '../state/laser-store';
import { StatusDisplay } from './StatusDisplay';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useLaserStore.setState({ statusReport: null });
});

function showReport(line: string): string {
  const event = smoothiewareDriver.classifyLine(line);
  if (event.kind !== 'status') throw new Error(`Not a status report: ${line}`);
  useLaserStore.setState({ statusReport: event.report });
  act(() => root.render(<StatusDisplay />));
  return host.textContent ?? '';
}

describe('StatusDisplay with Smoothieware reports', () => {
  it('hides the requested feed of a resting report', () => {
    const text = showReport(
      '<Idle|MPos:1.0000,2.0000,0.0000|WPos:1.0000,2.0000,0.0000|F:4000.0,100.0>',
    );
    expect(text).toContain('Idle');
    expect(text).not.toContain('F:');
  });

  it('shows the live feed, S and laser power while running', () => {
    const text = showReport(
      '<Run|MPos:1.0000,2.0000,0.0000|WPos:1.0000,2.0000,0.0000|F:1500.0,1500.0,100.0|L:37.5000|S:0.5000>',
    );
    expect(text).toContain('F: 1500 mm/min S: 0.5 L: 37.5%');
  });
});
