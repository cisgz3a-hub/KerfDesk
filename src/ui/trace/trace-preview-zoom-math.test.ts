import { describe, expect, it } from 'vitest';

import {
  classifyWheel,
  pinchStep,
  wheelZoomFactor,
  type WheelSample,
} from './trace-preview-gestures';
import {
  anchoredScrollOffset,
  DEFAULT_PREVIEW_ZOOM_RANGE,
  previewZoomRange,
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

describe('wheel gesture policy', () => {
  it('zooms for pinch, Ctrl/Cmd+wheel, line-mode wheels and large vertical notches', () => {
    expect(classifyWheel(sample({ ctrlKey: true, deltaY: 2 }), null).intent).toBe('zoom');
    expect(classifyWheel(sample({ metaKey: true, deltaY: 2 }), null).intent).toBe('zoom');
    expect(classifyWheel(sample({ deltaMode: 1, deltaY: 3 }), null).intent).toBe('zoom');
    expect(classifyWheel(sample({ deltaY: 100 }), null).intent).toBe('zoom');
    expect(classifyWheel(sample({ deltaY: 53.3 }), null).intent).toBe('zoom');
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
