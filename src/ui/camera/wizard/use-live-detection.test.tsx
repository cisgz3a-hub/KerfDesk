// Rendered-frame harness for the generalized detection hook (ADR-116): a
// capture closure standing in for any camera source feeds synthetic
// checkerboard frames (board-render-fixtures) and the hook must find corners
// and count stable ticks — machine cameras exercise exactly this path.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RgbaImage } from '../../../core/camera';
import { renderCheckerboardView } from '../../../core/camera/board-render-fixtures';
import {
  useLiveDetection,
  type LiveDetectCapture,
  type LiveDetectionState,
} from './use-live-detection';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SPEC = { rows: 6, cols: 9 };
const INTERVAL_MS = 50;

// The same Falcon-class fisheye pose the detector harness proves sub-pixel.
const BOARD_FRAME = grayToRgba(
  renderCheckerboardView({
    width: 320,
    height: 240,
    k: { fx: 180, fy: 180, cx: 160, cy: 120 },
    d: [-0.18, 0.03, 0, 0],
    rvec: [0, 0, 0],
    tvec: [-44, -27.5, 95],
    spec: SPEC,
    spacingMm: 11,
  }),
);

function grayToRgba(gray: {
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
}): RgbaImage {
  const data = new Uint8ClampedArray(gray.width * gray.height * 4);
  for (let i = 0; i < gray.data.length; i += 1) {
    const v = gray.data[i] ?? 0;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { data, width: gray.width, height: gray.height };
}

let latest: LiveDetectionState | null = null;

function Probe(props: { readonly capture: LiveDetectCapture | null }): JSX.Element {
  latest = useLiveDetection(props.capture, SPEC, true, INTERVAL_MS);
  return <div />;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  latest = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('useLiveDetection over a capture closure', () => {
  it('finds the board corners and counts consecutive stable ticks', () => {
    const capture: LiveDetectCapture = () => ({ frame: BOARD_FRAME, scale: 1 });
    act(() => root.render(<Probe capture={capture} />));
    act(() => {
      vi.advanceTimersByTime(INTERVAL_MS);
    });
    expect(latest?.corners).toHaveLength(SPEC.rows * SPEC.cols);
    expect(latest?.frameWidth).toBe(320);
    expect(latest?.frameHeight).toBe(240);
    expect(latest?.stableTicks).toBe(1);
    act(() => {
      vi.advanceTimersByTime(INTERVAL_MS);
    });
    expect(latest?.stableTicks).toBe(2);
  });

  it('maps corners back to full resolution through the capture scale', () => {
    // The same pixels declared as a half-scale grab of a 640×480 camera: all
    // corner coordinates and the frame size must double.
    const capture: LiveDetectCapture = () => ({ frame: BOARD_FRAME, scale: 0.5 });
    act(() => root.render(<Probe capture={capture} />));
    act(() => {
      vi.advanceTimersByTime(INTERVAL_MS);
    });
    expect(latest?.frameWidth).toBe(640);
    expect(latest?.frameHeight).toBe(480);
    const first = latest?.corners?.[0];
    expect(first).toBeDefined();
    if (first !== undefined) {
      expect(first.x).toBeGreaterThan(0);
      expect(first.x).toBeLessThan(640);
    }
  });

  it('resets to idle when the capture yields nothing', () => {
    const frames: Array<{ frame: RgbaImage; scale: number } | null> = [
      { frame: BOARD_FRAME, scale: 1 },
      null,
    ];
    let call = 0;
    const capture: LiveDetectCapture = () => frames[Math.min(call++, frames.length - 1)] ?? null;
    act(() => root.render(<Probe capture={capture} />));
    act(() => {
      vi.advanceTimersByTime(INTERVAL_MS);
    });
    expect(latest?.stableTicks).toBe(1);
    act(() => {
      vi.advanceTimersByTime(INTERVAL_MS);
    });
    expect(latest?.corners).toBeNull();
    expect(latest?.stableTicks).toBe(0);
  });
});
