import { describe, expect, it } from 'vitest';

import {
  classifyWheel,
  pinchStep,
  wheelZoomFactor,
  type WheelSample,
} from './trace-preview-gestures';
import {
  anchoredScrollOffset,
  clampPreviewZoomToward,
  clampScrollOffset,
  DEFAULT_PREVIEW_ZOOM_RANGE,
  liveLensTransform,
  previewZoomRange,
  reachableActualSize,
  stepPreviewZoom,
} from './trace-preview-zoom-math';

const sample = (overrides: Partial<WheelSample>): WheelSample => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  timeStamp: 0,
  ...overrides,
});

describe('preview zoom range', () => {
  it('keeps 1x-16x Fit without a measurable image, and reaches 1:1 either side of Fit', () => {
    expect(previewZoomRange(undefined, { width: 300, height: 200 })).toBe(
      DEFAULT_PREVIEW_ZOOM_RANGE,
    );
    expect(previewZoomRange({ width: 10, height: 10 }, { width: 0, height: 0 })).toBe(
      DEFAULT_PREVIEW_ZOOM_RANGE,
    );
    // Small icon: Fit enlarges 3x, so 1:1 is below Fit.
    const small = previewZoomRange({ width: 100, height: 50 }, { width: 300, height: 200 });
    expect(small).toEqual({ min: 1 / 3, max: 16, actualSize: 1 / 3 });
    // Large photo: 1:1 is 10x Fit; allow 4 screen px per source px (40x).
    const large = previewZoomRange({ width: 6000, height: 4000 }, { width: 600, height: 400 });
    expect(large).toEqual({ min: 1, max: 40, actualSize: 10 });
    // Huge scans stop at 64x Fit.
    expect(previewZoomRange({ width: 60000, height: 100 }, { width: 600, height: 400 }).max).toBe(
      64,
    );
  });

  it('offers 1:1 only when the range can show it', () => {
    // 1,254 px art in 600x280: Fit to 17.9x Fit, with 1:1 at 4.48x Fit inside it.
    const art = previewZoomRange({ width: 1254, height: 1254 }, { width: 600, height: 280 });
    expect(art.min).toBe(1);
    expect(art.max).toBeCloseTo(17.914, 3);
    expect(reachableActualSize(art)).toBeCloseTo(4.479, 3);
    // A 60,000 px scan needs 214x Fit for 1:1, beyond the 64x cap.
    const scan = previewZoomRange({ width: 60000, height: 100 }, { width: 600, height: 400 });
    expect(scan.actualSize).toBe(100);
    expect(reachableActualSize(scan)).toBeNull();
    expect(reachableActualSize(DEFAULT_PREVIEW_ZOOM_RANGE)).toBeNull();
  });

  it('never clamps a zoom against the direction it was asked to move', () => {
    const range = { min: 0.8, max: 16, actualSize: 0.8 };
    // Left at 0.5 by an earlier, wider range: zooming out must not jump IN to 0.8.
    expect(clampPreviewZoomToward(0.5, 0.4, range)).toBe(0.5);
    expect(clampPreviewZoomToward(0.5, 0.6, range)).toBe(0.8);
    expect(clampPreviewZoomToward(20, 24, range)).toBe(20);
    expect(clampPreviewZoomToward(20, 18, range)).toBe(16);
    expect(clampPreviewZoomToward(2, 0.1, range)).toBe(0.8);
    expect(clampPreviewZoomToward(2, 99, range)).toBe(16);
  });

  it('steps by doubling but stops on Fit when a step crosses it', () => {
    expect(stepPreviewZoom(1, 1)).toBe(2);
    expect(stepPreviewZoom(3, -1)).toBe(1.5);
    expect(stepPreviewZoom(1.5, -1)).toBe(1);
    expect(stepPreviewZoom(1, -1)).toBe(0.5);
    expect(stepPreviewZoom(0.6, 1)).toBe(1);
  });
});

describe('anchored scroll offset', () => {
  it('keeps the anchored stage point under the cursor and clamps to the scroll range', () => {
    const args = { scroll: 0, anchor: 75, size: 300, previous: 1, next: 2 };
    expect(anchoredScrollOffset(args)).toBe(75);
    // Point 0.25 across a 2x stage lands back under x=75 after 4x.
    expect(anchoredScrollOffset({ ...args, scroll: 75, previous: 2, next: 4 })).toBe(225);
    expect(anchoredScrollOffset({ ...args, scroll: 450, anchor: 300, previous: 2, next: 1 })).toBe(
      0,
    );
    expect(anchoredScrollOffset({ ...args, anchor: 300, next: 16 })).toBe(4500);
  });

  it('accounts for the centring margin of a stage smaller than the viewport', () => {
    // A half-size stage is centred with a 75 px margin; zooming back to Fit about
    // its right edge keeps no scroll, and zooming to 2x maps its middle correctly.
    expect(
      anchoredScrollOffset({ scroll: 0, anchor: 150, size: 300, previous: 0.5, next: 2 }),
    ).toBe(150);
    expect(
      anchoredScrollOffset({ scroll: 0, anchor: 225, size: 300, previous: 0.5, next: 1 }),
    ).toBe(0);
  });
});

describe('live lens transform', () => {
  const size = { width: 300, height: 200 };

  it('shows the re-laid view: every stage point lands where it will after the re-layout', () => {
    // Laid out at 2x, scrolled (150, 100); the gesture aims at 3x, scroll (300, 150).
    const t = liveLensTransform({
      size,
      rendered: 2,
      target: 3,
      scroll: { left: 150, top: 100 },
      targetScroll: { left: 300, top: 150 },
    });
    expect(t).toEqual({ x: -150, y: -50, scale: 1.5 });
    // Stage point (240, 160) sits at (90, 60) on screen now. Scaled about the
    // stage origin (-150, -100) and shifted, it lands at (60, 90), exactly where
    // the 3x stage scrolled to (300, 150) will draw it.
    const p = { x: 240, y: 160 };
    expect(-150 + t!.x + t!.scale * p.x).toBe(p.x * 1.5 - 300);
    expect(-100 + t!.y + t!.scale * p.y).toBe(p.y * 1.5 - 150);
  });

  it('includes the centring margin of a stage smaller than the viewport', () => {
    // A 0.5x stage (150x100) sits at (75, 50); at 1x it fills the viewport.
    const t = liveLensTransform({
      size,
      rendered: 0.5,
      target: 1,
      scroll: { left: 0, top: 0 },
      targetScroll: { left: 0, top: 0 },
    });
    expect(t).toEqual({ x: -75, y: -50, scale: 2 });
    expect(
      liveLensTransform({
        size: { width: 0, height: 1 },
        rendered: 1,
        target: 2,
        scroll: { left: 0, top: 0 },
        targetScroll: { left: 0, top: 0 },
      }),
    ).toBeNull();
  });

  it('clamps a pending pan to the target stage scroll range', () => {
    expect(clampScrollOffset(-5, 300, 2)).toBe(0);
    expect(clampScrollOffset(400, 300, 2)).toBe(300);
    expect(clampScrollOffset(120, 300, 2)).toBe(120);
    expect(clampScrollOffset(40, 300, 0.5)).toBe(0);
    expect(clampScrollOffset(Number.NaN, 300, 2)).toBe(0);
  });
});

describe('wheel gesture policy', () => {
  it('zooms for pinch, Ctrl/Cmd+wheel, line-mode wheels and large vertical notches', () => {
    expect(classifyWheel(sample({ ctrlKey: true, deltaY: 2 }), null).intent).toBe('zoom');
    expect(classifyWheel(sample({ metaKey: true, deltaY: 2 }), null).intent).toBe('zoom');
    expect(classifyWheel(sample({ deltaMode: 1, deltaY: 3 }), null).intent).toBe('zoom');
    expect(classifyWheel(sample({ deltaY: 100 }), null).intent).toBe('zoom');
    expect(classifyWheel(sample({ deltaY: 53.3 }), null).intent).toBe('zoom');
    // Windows at 1 or 2 lines per notch: Chromium reports 100/3 px per line.
    expect(classifyWheel(sample({ deltaY: 100 / 3 }), null).intent).toBe('zoom');
    expect(classifyWheel(sample({ deltaY: -100 / 3 }), null).intent).toBe('zoom');
    expect(classifyWheel(sample({ deltaY: 33.33 }), null).intent).toBe('zoom');
    // Continuous trackpad deltas near, but not on, a line count still pan.
    expect(classifyWheel(sample({ deltaY: 33 }), null).intent).toBe('pan');
    expect(classifyWheel(sample({ deltaY: 40 }), null).intent).toBe('pan');
    expect(classifyWheel(sample({ deltaY: 12 }), null).intent).toBe('pan');
  });

  it('pans for trackpad drags and Shift+wheel, latching intent for the whole gesture', () => {
    const start = classifyWheel(sample({ deltaY: 4, timeStamp: 1000 }), null);
    expect(start.intent).toBe('pan');
    // A momentum burst inside the same gesture must not turn into a zoom.
    const flick = classifyWheel(sample({ deltaY: 120, timeStamp: 1016 }), start.latch);
    expect(flick.intent).toBe('pan');
    // After an idle gap a new gesture is classified afresh.
    expect(classifyWheel(sample({ deltaY: 120, timeStamp: 1400 }), flick.latch).intent).toBe(
      'zoom',
    );
    expect(classifyWheel(sample({ deltaX: 2, deltaY: 80 }), null).intent).toBe('pan');
    expect(classifyWheel(sample({ shiftKey: true, deltaY: 100 }), null).intent).toBe('pan');
  });

  it('maps wheel deltas to bounded multiplicative zoom steps', () => {
    expect(wheelZoomFactor(sample({ deltaY: -100 }))).toBeCloseTo(1.2, 10);
    expect(wheelZoomFactor(sample({ deltaY: 100 }))).toBeCloseTo(1 / 1.2, 10);
    // A 1-line or 2-line Windows notch zooms as much as a default 3-line one.
    expect(wheelZoomFactor(sample({ deltaY: -100 / 3 }))).toBeCloseTo(1.2, 10);
    expect(wheelZoomFactor(sample({ deltaY: 200 / 3 }))).toBeCloseTo(1 / 1.2, 10);
    expect(wheelZoomFactor(sample({ ctrlKey: true, deltaY: -100 / 3 }))).toBeCloseTo(1.2, 10);
    expect(wheelZoomFactor(sample({ deltaMode: 1, deltaY: -3 }))).toBeCloseTo(1.2 ** 1.2, 10);
    expect(wheelZoomFactor(sample({ ctrlKey: true, deltaY: -10 }))).toBeCloseTo(Math.exp(0.1), 10);
    expect(wheelZoomFactor(sample({ deltaMode: 2, deltaY: -5 }))).toBe(2);
    expect(wheelZoomFactor(sample({ deltaY: Number.NaN }))).toBe(1);
  });

  it('turns two-finger touch moves into spread-ratio zoom and midpoint pan', () => {
    const step = pinchStep(
      [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
      [
        { x: 110, y: 120 },
        { x: 310, y: 120 },
      ],
    );
    expect(step.factor).toBe(2);
    expect(step.anchor).toEqual({ x: 210, y: 120 });
    expect(step.pan).toEqual({ x: -60, y: -20 });
  });
});
