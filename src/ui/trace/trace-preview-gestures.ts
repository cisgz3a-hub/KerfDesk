// Pure wheel-gesture policy for the trace preview.
//
// Browsers deliver three different physical gestures as `wheel` events:
//   - a mouse wheel notch: line/page delta mode, or a large vertical-only
//     pixel delta (Chromium reports about 100 px per notch on Windows);
//   - a trackpad two-finger drag: small pixel deltas, often with an X part;
//   - a trackpad pinch: Chromium (and so Electron) sets ctrlKey on the
//     synthesised wheel event.
// A pinch or Ctrl/Cmd+wheel always zooms. Otherwise the FIRST event of a
// gesture is classified and the whole gesture (including trackpad momentum)
// keeps that intent, so a fast two-finger flick never turns into a zoom halfway
// through. Pan intents are left to the browser's native, inertial scrolling.

export type WheelIntent = 'zoom' | 'pan';

export type WheelSample = {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly timeStamp: number;
};

export type WheelLatch = { readonly intent: WheelIntent; readonly lastTime: number };

/** Idle gap that ends one wheel gesture (notch run or trackpad momentum). */
export const WHEEL_GESTURE_GAP_MS = 200;
/** Smallest vertical-only pixel delta treated as a discrete mouse notch. */
const WHEEL_NOTCH_MIN_PX = 50;
const LINE_PX = 40;
const PAGE_PX = 800;
// About 1.2x per 100 px notch; pinch deltas are small, so they zoom faster per px.
const NOTCH_ZOOM_RATE = Math.log(1.2) / 100;
const PINCH_ZOOM_RATE = 0.01;
const MAX_STEP_FACTOR = 2;

export function classifyWheel(
  sample: WheelSample,
  latch: WheelLatch | null,
): { readonly intent: WheelIntent; readonly latch: WheelLatch | null } {
  if (sample.ctrlKey || sample.metaKey) return { intent: 'zoom', latch };
  if (sample.shiftKey) return { intent: 'pan', latch: null };
  const continues = latch !== null && sample.timeStamp - latch.lastTime < WHEEL_GESTURE_GAP_MS;
  const intent = continues ? latch.intent : firstEventIntent(sample);
  return { intent, latch: { intent, lastTime: sample.timeStamp } };
}

/** Multiplicative zoom for one wheel event; wheel-down zooms out. */
export function wheelZoomFactor(sample: WheelSample): number {
  const pixels = wheelPixels(sample.deltaY, sample.deltaMode);
  const isPinch = (sample.ctrlKey || sample.metaKey) && Math.abs(pixels) < WHEEL_NOTCH_MIN_PX;
  const factor = Math.exp(-pixels * (isPinch ? PINCH_ZOOM_RATE : NOTCH_ZOOM_RATE));
  if (!Number.isFinite(factor) || factor <= 0) return 1;
  return Math.max(1 / MAX_STEP_FACTOR, Math.min(MAX_STEP_FACTOR, factor));
}

type Point = { readonly x: number; readonly y: number };

/** Two-finger touch step: zoom by the spread ratio, pan by the midpoint move. */
export function pinchStep(
  previous: readonly [Point, Point],
  next: readonly [Point, Point],
): { readonly factor: number; readonly anchor: Point; readonly pan: Point } {
  const before = distance(previous[0], previous[1]);
  const after = distance(next[0], next[1]);
  const anchor = midpoint(next[0], next[1]);
  const start = midpoint(previous[0], previous[1]);
  const factor = before > 0 && after > 0 ? after / before : 1;
  return { factor, anchor, pan: { x: start.x - anchor.x, y: start.y - anchor.y } };
}

function firstEventIntent(sample: WheelSample): WheelIntent {
  if (sample.deltaMode !== 0) return 'zoom';
  const isNotch = sample.deltaX === 0 && Math.abs(sample.deltaY) >= WHEEL_NOTCH_MIN_PX;
  return isNotch ? 'zoom' : 'pan';
}

function wheelPixels(delta: number, mode: number): number {
  if (!Number.isFinite(delta)) return 0;
  if (mode === 1) return delta * LINE_PX;
  if (mode === 2) return delta * PAGE_PX;
  return delta;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
