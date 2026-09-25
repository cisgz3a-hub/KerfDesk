import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
  button,
  click,
  key,
  lens,
  mountNavigationPreview,
  pointer,
  previewHost,
  renderNavigationPreview,
  resizeViewport,
  settleLive,
  stage,
  unmountNavigationPreview,
  viewport,
  wheel,
  type BoundaryListener,
} from './trace-preview-navigation.test-support';

let onBoundaryChange: Mock<BoundaryListener>;

beforeEach(async () => {
  onBoundaryChange = vi.fn<BoundaryListener>();
  await mountNavigationPreview(onBoundaryChange);
});

afterEach(unmountNavigationPreview);

describe('TracePreview wheel and pinch zoom', () => {
  it('zooms a mouse-wheel notch about the cursor without touching the trace', async () => {
    const path = previewHost().querySelector('#nav-line');
    const event = await wheel({ deltaY: -100, clientX: 75, clientY: 50 });
    expect(event.defaultPrevented).toBe(true);
    await settleLive();
    expect(parseFloat(stage().style.width)).toBeCloseTo(120, 6);
    // The source point under the cursor (a quarter across) stays under it.
    expect(viewport().scrollLeft).toBeCloseTo(0.25 * 360 - 75, 6);
    expect(viewport().scrollTop).toBeCloseTo(0.25 * 240 - 50, 6);
    await wheel({ deltaY: 100, clientX: 75, clientY: 50 }, 20);
    await settleLive();
    expect(parseFloat(stage().style.width)).toBeCloseTo(100, 6);
    expect(previewHost().querySelector('#nav-line')).toBe(path);
    expect(onBoundaryChange).not.toHaveBeenCalled();
  });

  it('zooms a trackpad pinch (Ctrl+wheel) continuously and blocks page zoom', async () => {
    const event = await wheel({ deltaY: -10, ctrlKey: true, clientX: 150, clientY: 100 });
    expect(event.defaultPrevented).toBe(true);
    await settleLive();
    expect(parseFloat(stage().style.width)).toBeCloseTo(100 * Math.exp(0.1), 6);
  });

  it('scales the painted artwork during a wheel burst and re-lays the stage once it settles', async () => {
    const renders = stage().style;
    const first = await wheel({ deltaY: -100, clientX: 75, clientY: 50 });
    const second = await wheel({ deltaY: -100, clientX: 75, clientY: 50 }, 16);
    expect([first.defaultPrevented, second.defaultPrevented]).toEqual([true, true]);
    // Mid-burst: no stage re-layout (no trace re-raster), only a lens transform
    // that keeps the source point under the cursor still: -s + 1.44 * 75 = 75.
    expect(renders.width).toBe('100%');
    const [x, y, scale] = (lens().style.transform.match(/-?[\d.]+/g) ?? []).map(Number);
    expect([x, y, scale].map((n) => Math.round((n ?? Number.NaN) * 1e6) / 1e6)).toEqual([
      -33, -22, 1.44,
    ]);
    expect(viewport().scrollLeft).toBe(0);
    await settleLive();
    expect(parseFloat(stage().style.width)).toBeCloseTo(144, 6);
    expect(viewport().scrollLeft).toBeCloseTo(0.25 * 432 - 75, 6);
    expect(viewport().scrollTop).toBeCloseTo(0.25 * 288 - 50, 6);
    expect(lens().style.transform).toBe('');
  });

  it('lays out a live wheel zoom before a Boundary drag starts', async () => {
    await wheel({ deltaY: -100, clientX: 75, clientY: 50 });
    expect(stage().style.width).toBe('100%');
    await pointer('pointerdown', { id: 1, button: 0, x: 30, y: 20 });
    expect(parseFloat(stage().style.width)).toBeCloseTo(120, 6);
    expect(lens().style.transform).toBe('');
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
    await settleLive();
    expect(parseFloat(stage().style.width)).toBeCloseTo(200, 6);
    await pointer('pointerup', { id: 2, type: 'touch', x: 300, y: 100 });
    const before = { left: viewport().scrollLeft, top: viewport().scrollTop };
    await pointer('pointermove', { id: 1, type: 'touch', x: 90, y: 95 });
    expect(viewport().scrollLeft).toBeCloseTo(before.left + 10, 6);
    expect(viewport().scrollTop).toBeCloseTo(before.top + 5, 6);
    await pointer('pointerup', { id: 1, type: 'touch', x: 90, y: 95 });
    expect(onBoundaryChange).not.toHaveBeenCalled();
  });

  it('lets a plain wheel-out at the smallest zoom scroll the page, but not Ctrl+wheel', async () => {
    await key('1'); // 1:1 is this small image's minimum zoom.
    const width = stage().style.width;
    const out = await wheel({ deltaY: 100, clientX: 150, clientY: 100 });
    expect(out.defaultPrevented).toBe(false);
    expect(stage().style.width).toBe(width);
    const pinchOut = await wheel({ deltaY: 5, ctrlKey: true, clientX: 150, clientY: 100 });
    expect(pinchOut.defaultPrevented).toBe(true);
    const zoomIn = await wheel({ deltaY: -100, clientX: 150, clientY: 100 }, 20);
    expect(zoomIn.defaultPrevented).toBe(true);
    await settleLive();
    expect(parseFloat(stage().style.width)).toBeGreaterThan(parseFloat(width));
  });

  it('still claims a wheel-in at the largest zoom so it cannot pan the view', async () => {
    for (let i = 0; i < 4; i += 1) await click('Zoom in');
    expect(stage().style.width).toBe('1600%');
    const top = viewport().scrollTop;
    const event = await wheel({ deltaY: -100, clientX: 150, clientY: 100 });
    expect(event.defaultPrevented).toBe(true);
    expect(stage().style.width).toBe('1600%');
    expect(viewport().scrollTop).toBe(top);
  });

  it('pulls the zoom back into range when the viewport resizes, never jumping on zoom-out', async () => {
    await key('1');
    expect(parseFloat(stage().style.width)).toBeCloseTo(100 / 1.5, 6);
    // Stacked layout: 150x100 makes Fit 0.75 px per source px, so 1:1 is 1.33x
    // Fit and the old 0.67x zoom falls below the new Fit minimum.
    await resizeViewport(150, 100);
    expect(stage().style.width).toBe('100%');
    const out = await wheel({ deltaY: 100, clientX: 75, clientY: 50 });
    expect(out.defaultPrevented).toBe(false);
    expect(stage().style.width).toBe('100%');
    await act(async () => button('1:1 actual size').click());
    expect(parseFloat(stage().style.width)).toBeCloseTo(400 / 3, 6);
  });

  it('disables 1:1 when it lies beyond the zoom cap', async () => {
    await renderNavigationPreview({ width: 60_000, height: 100 });
    await act(async () => window.dispatchEvent(new Event('resize')));
    const oneToOne = button('1:1 actual size');
    expect(oneToOne.disabled).toBe(true);
    expect(oneToOne.title).toMatch(/beyond this preview's 64 times limit/);
    await key('1');
    expect(stage().style.width).toBe('100%');
  });
});

describe('TracePreview keyboard and accessibility', () => {
  it('is a labelled, focusable region described by its navigation help', () => {
    expect(viewport().getAttribute('role')).toBe('region');
    expect(viewport().tabIndex).toBe(0);
    const help = document.getElementById(viewport().getAttribute('aria-describedby') ?? '');
    expect(help?.textContent).toMatch(/Wheel or pinch to zoom/);
    expect(help?.textContent).toMatch(/Space\+drag/);
    for (const name of ['Zoom out', 'Zoom in', '1:1 actual size']) {
      expect(button(name).getAttribute('aria-label')).toBe(name);
    }
    expect(button('Fit').textContent).toBe('Fit');
    // WCAG 2.5.3: the accessible name contains the visible label.
    const oneToOne = button('1:1 actual size');
    expect(oneToOne.textContent).toBe('1:1');
    expect(oneToOne.getAttribute('aria-label')).toContain(oneToOne.textContent);
    expect(oneToOne.title).toMatch(/CSS pixel/);
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
    await act(async () => button('1:1 actual size').click());
    expect(parseFloat(stage().style.width)).toBeCloseTo(100 / 1.5, 6);
    expect(previewHost().querySelector('[aria-label="Preview magnification"]')?.textContent).toBe(
      '0.7×',
    );
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
