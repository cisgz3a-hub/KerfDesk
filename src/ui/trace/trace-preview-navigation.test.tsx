import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TracePreview } from './TracePreview';
import type { TracePreviewState } from './use-trace-preview';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ready: TracePreviewState = {
  kind: 'ready',
  svg: '<svg viewBox="0 0 200 100"><path id="nav-line" d="M20 10L60 40"/></svg>',
  width: 200,
  height: 100,
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 20, y: 10 },
            { x: 60, y: 40 },
          ],
        },
      ],
    },
  ],
};

let root: Root;
let host: HTMLDivElement;
let onBoundaryChange: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  onBoundaryChange = vi.fn();
  await act(async () =>
    root.render(
      createElement(TracePreview, {
        state: ready,
        sourceDataUrl: 'data:image/png;base64,AAA',
        imageSize: { width: 200, height: 100 },
        onBoundaryChange,
      }),
    ),
  );
  // A 300x200 viewport at the window origin; jsdom has no layout.
  Object.defineProperties(viewport(), {
    clientWidth: { configurable: true, value: 300 },
    clientHeight: { configurable: true, value: 200 },
  });
  viewport().getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200 }) as DOMRect;
  stage().getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200 }) as DOMRect;
  await act(async () => window.dispatchEvent(new Event('resize')));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('TracePreview wheel and pinch zoom', () => {
  it('zooms a mouse-wheel notch about the cursor without touching the trace', async () => {
    const path = host.querySelector('#nav-line');
    const event = await wheel({ deltaY: -100, clientX: 75, clientY: 50 });
    expect(event.defaultPrevented).toBe(true);
    expect(parseFloat(stage().style.width)).toBeCloseTo(120, 6);
    // The source point under the cursor (a quarter across) stays under it.
    expect(viewport().scrollLeft).toBeCloseTo(0.25 * 360 - 75, 6);
    expect(viewport().scrollTop).toBeCloseTo(0.25 * 240 - 50, 6);
    await wheel({ deltaY: 100, clientX: 75, clientY: 50 }, 20);
    expect(parseFloat(stage().style.width)).toBeCloseTo(100, 6);
    expect(host.querySelector('#nav-line')).toBe(path);
    expect(onBoundaryChange).not.toHaveBeenCalled();
  });

  it('zooms a trackpad pinch (Ctrl+wheel) continuously and blocks page zoom', async () => {
    const event = await wheel({ deltaY: -10, ctrlKey: true, clientX: 150, clientY: 100 });
    expect(event.defaultPrevented).toBe(true);
    expect(parseFloat(stage().style.width)).toBeCloseTo(100 * Math.exp(0.1), 6);
  });

  it('keeps panning live after wheel steps that return to the rendered zoom in one frame', async () => {
    await click('Zoom in');
    await act(async () => {
      for (const deltaY of [-100, 100]) {
        stage().dispatchEvent(
          new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, clientX: 30 }),
        );
      }
    });
    expect(parseFloat(stage().style.width)).toBeCloseTo(200, 6);
    const left = viewport().scrollLeft;
    await pointer('pointerdown', { id: 4, button: 1, x: 100, y: 100 });
    await pointer('pointermove', { id: 4, button: 1, x: 90, y: 100 });
    expect(viewport().scrollLeft).toBeCloseTo(left + 10, 6);
  });

  it('leaves a trackpad two-finger drag to native scrolling', async () => {
    const event = await wheel({ deltaX: 3, deltaY: 4, clientX: 150, clientY: 100 });
    expect(event.defaultPrevented).toBe(false);
    expect(stage().style.width).toBe('100%');
  });

  it('pinches and pans with two touch fingers, and pans with one', async () => {
    await pointer('pointerdown', { id: 1, type: 'touch', x: 100, y: 100 });
    await pointer('pointerdown', { id: 2, type: 'touch', x: 200, y: 100 });
    await pointer('pointermove', { id: 2, type: 'touch', x: 300, y: 100 });
    expect(parseFloat(stage().style.width)).toBeCloseTo(200, 6);
    await pointer('pointerup', { id: 2, type: 'touch', x: 300, y: 100 });
    const before = { left: viewport().scrollLeft, top: viewport().scrollTop };
    await pointer('pointermove', { id: 1, type: 'touch', x: 90, y: 95 });
    expect(viewport().scrollLeft).toBeCloseTo(before.left + 10, 6);
    expect(viewport().scrollTop).toBeCloseTo(before.top + 5, 6);
    await pointer('pointerup', { id: 1, type: 'touch', x: 90, y: 95 });
    expect(onBoundaryChange).not.toHaveBeenCalled();
  });
});

describe('TracePreview drag to pan', () => {
  it('pans by middle-drag and suppresses middle-button autoscroll', async () => {
    await click('Zoom in');
    expect([viewport().scrollLeft, viewport().scrollTop]).toEqual([150, 100]);
    await pointer('pointerdown', { id: 7, button: 1, x: 100, y: 100 });
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 });
    await act(async () => stage().dispatchEvent(mouseDown));
    expect(mouseDown.defaultPrevented).toBe(true);
    expect(viewport().dataset['pan']).toBe('panning');
    await pointer('pointermove', { id: 7, button: 1, x: 80, y: 90 });
    expect([viewport().scrollLeft, viewport().scrollTop]).toEqual([170, 110]);
    await pointer('pointerup', { id: 7, button: 1, x: 80, y: 90 });
    expect(viewport().dataset['pan']).toBe('idle');
    expect(onBoundaryChange).not.toHaveBeenCalled();
  });

  it('pans by Space+drag instead of drawing a Boundary, then primary drag draws again', async () => {
    await click('Zoom in');
    await pointer('pointerenter', { id: 1, x: 10, y: 10 });
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    await act(async () => document.body.dispatchEvent(space));
    expect(space.defaultPrevented).toBe(true);
    expect(viewport().dataset['pan']).toBe('ready');
    await pointer('pointerdown', { id: 1, button: 0, x: 100, y: 100 });
    await mouse('mousedown', 100, 100);
    await pointer('pointermove', { id: 1, button: 0, x: 60, y: 70 });
    await mouse('mousemove', 60, 70);
    expect(host.querySelector('[aria-label="Trace boundary"]')).toBeNull();
    await pointer('pointerup', { id: 1, button: 0, x: 60, y: 70 });
    await mouse('mouseup', 60, 70);
    expect([viewport().scrollLeft, viewport().scrollTop]).toEqual([190, 130]);
    expect(onBoundaryChange).not.toHaveBeenCalled();
    await act(async () =>
      document.body.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true })),
    );
    expect(viewport().dataset['pan']).toBe('idle');

    await pointer('pointerdown', { id: 1, button: 0, x: 30, y: 20 });
    await mouse('mousedown', 30, 20);
    await mouse('mousemove', 90, 80);
    await mouse('mouseup', 90, 80);
    expect(onBoundaryChange).toHaveBeenCalledTimes(1);
    expect(viewport().scrollLeft).toBe(190);
  });

  it('does not claim Space typed into a text field', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      await pointer('pointerenter', { id: 1, x: 10, y: 10 });
      const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
      await act(async () => input.dispatchEvent(space));
      expect(space.defaultPrevented).toBe(false);
      expect(viewport().dataset['pan']).toBe('idle');
    } finally {
      input.remove();
    }
  });
});

describe('TracePreview keyboard and accessibility', () => {
  it('is a labelled, focusable region described by its navigation help', () => {
    expect(viewport().getAttribute('role')).toBe('region');
    expect(viewport().tabIndex).toBe(0);
    const help = document.getElementById(viewport().getAttribute('aria-describedby') ?? '');
    expect(help?.textContent).toMatch(/Wheel or pinch to zoom/);
    expect(help?.textContent).toMatch(/Space\+drag/);
    for (const name of ['Zoom out', 'Zoom in', 'Actual size']) {
      expect(button(name).getAttribute('aria-label')).toBe(name);
    }
    expect(button('Fit').textContent).toBe('Fit');
    expect(button('Actual size').textContent).toBe('1:1');
  });

  it('focuses on pointer down and zooms with + - 0 1 keys', async () => {
    await pointer('pointerdown', { id: 1, button: 0, x: 10, y: 10 });
    expect(document.activeElement).toBe(viewport());
    await key('+');
    expect(stage().style.width).toBe('200%');
    await key('-');
    expect(stage().style.width).toBe('100%');
    // 200x100 source in 300x200: Fit is 1.5 screen px per source px.
    await key('1');
    expect(parseFloat(stage().style.width)).toBeCloseTo(100 / 1.5, 6);
    expect(button('Zoom out').disabled).toBe(true);
    await key('0');
    expect(stage().style.width).toBe('100%');
    await act(async () => button('Actual size').click());
    expect(parseFloat(stage().style.width)).toBeCloseTo(100 / 1.5, 6);
    expect(host.querySelector('[aria-label="Preview magnification"]')?.textContent).toBe('0.7×');
    expect(onBoundaryChange).not.toHaveBeenCalled();
  });

  it('keeps browser shortcuts such as Ctrl+= away from preview zoom', async () => {
    const event = new KeyboardEvent('keydown', {
      key: '=',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => viewport().dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(stage().style.width).toBe('100%');
  });
});

function viewport(): HTMLDivElement {
  return host.querySelector('[aria-label="Preview viewport"]') as HTMLDivElement;
}

function stage(): HTMLDivElement {
  return host.querySelector('[aria-label="Trace preview"]') as HTMLDivElement;
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (node) => node.getAttribute('aria-label') === label || node.textContent === label,
  );
  if (found === undefined) throw new Error(`Missing button: ${label}`);
  return found;
}

async function click(label: string): Promise<void> {
  await act(async () => button(label).click());
}

async function key(value: string): Promise<void> {
  await act(async () =>
    viewport().dispatchEvent(
      new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
    ),
  );
}

let wheelClock = 1_000;
async function wheel(init: WheelEventInit, gapMs = 1_000): Promise<WheelEvent> {
  wheelClock += gapMs;
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'timeStamp', { value: wheelClock });
  await act(async () => stage().dispatchEvent(event));
  return event;
}

// jsdom has no PointerEvent; a MouseEvent with pointer fields exercises the same handlers.
async function pointer(
  type: string,
  init: {
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly button?: number;
    readonly type?: 'mouse' | 'touch';
  },
): Promise<void> {
  const event = new MouseEvent(type, {
    bubbles: type !== 'pointerenter',
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.x,
    clientY: init.y,
  });
  Object.defineProperties(event, {
    pointerId: { value: init.id },
    pointerType: { value: init.type ?? 'mouse' },
  });
  await act(async () => (type === 'pointerenter' ? viewport() : stage()).dispatchEvent(event));
}

async function mouse(type: string, x: number, y: number): Promise<void> {
  await act(async () =>
    stage().dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }),
    ),
  );
}
