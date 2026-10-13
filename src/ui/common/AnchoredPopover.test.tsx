import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnchoredPopover } from './AnchoredPopover';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.restoreAllMocks());

describe('AnchoredPopover layout changes', () => {
  it('caps the height and keeps controls on screen when the trigger is scrolled away', async () => {
    const anchor = document.createElement('button');
    const host = document.createElement('div');
    document.body.append(anchor, host);
    const root = createRoot(host);
    const ref = createRef<HTMLElement>();
    Object.defineProperty(ref, 'current', { value: anchor });
    let y = -400;
    vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => ({
      x: 20,
      y,
      top: y,
      bottom: y + 30,
      left: 20,
      right: 120,
      width: 100,
      height: 30,
      toJSON: () => ({}),
    }));
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
    try {
      await act(async () =>
        root.render(
          <AnchoredPopover
            id="bounds-test"
            label="Bounds"
            role="dialog"
            anchorRef={ref}
            onClose={() => undefined}
          >
            <button>Last control</button>
          </AnchoredPopover>,
        ),
      );
      const panel = document.getElementById('bounds-test');
      if (!panel) throw new Error('Missing popup');
      for (const top of [-400, window.innerHeight + 400]) {
        y = top;
        await act(async () => window.dispatchEvent(new Event('scroll')));
        expect(Number.parseFloat(panel.style.top)).toBeGreaterThanOrEqual(8);
        expect(
          Number.parseFloat(panel.style.top) + Number.parseFloat(panel.style.maxHeight),
        ).toBeLessThanOrEqual(window.innerHeight - 8);
      }
    } finally {
      await act(async () => root.unmount());
      anchor.remove();
      host.remove();
    }
  });

  it('repositions after a sibling recovery section grows', async () => {
    const rail = document.createElement('aside');
    rail.className = 'test-rail';
    const recovery = document.createElement('section');
    const anchor = document.createElement('button');
    rail.append(recovery, anchor);
    const host = document.createElement('div');
    document.body.append(rail, host);
    const root = createRoot(host);
    const ref = createRef<HTMLElement>();
    Object.defineProperty(ref, 'current', { value: anchor });
    let y = 80;
    vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => ({
      x: 20,
      y,
      top: y,
      bottom: y + 30,
      left: 20,
      right: 120,
      width: 100,
      height: 30,
      toJSON: () => ({}),
    }));
    const observed: Element[] = [];
    let resize: () => void = () => undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe(element: Element): void {
          observed.push(element);
        }
        disconnect(): void {
          /* test observer */
        }
      },
    );
    try {
      await act(async () =>
        root.render(
          <AnchoredPopover
            id="layout-test"
            label="Layout"
            role="dialog"
            anchorRef={ref}
            layoutRootSelector=".test-rail"
            onClose={() => undefined}
          >
            <button>Control</button>
          </AnchoredPopover>,
        ),
      );
      const panel = document.getElementById('layout-test');
      expect(observed).toContain(recovery);
      expect(panel?.style.top).toBe('115px');
      y = 160;
      await act(async () => resize());
      expect(panel?.style.top).toBe('195px');
    } finally {
      await act(async () => root.unmount());
      rail.remove();
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});
