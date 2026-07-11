// fill-pinholes — fills hairline binarization cracks inside solid ink.
//
// Thresholding anti-aliased or subtly-shaded artwork can slice a hairline
// white sliver through solid ink (the Arch House 'H' stem traced with a
// crack down its middle, tick-holes inside the 'O'). A faithful contour
// tracer then reproduces the damage as spurious inner contours.
//
// A pinhole is filled only when ALL THREE hold — each guard protects a real
// feature class measured in the arch-house pinhole audit:
//   1. ENCLOSED: unreachable from the border background. Letter-spacing gaps
//      connect to the outside and are never touched.
//   2. THIN: max inscribed radius ≤ 1px (a sliver ≤ ~2px wide). Letter
//      counters ('A', 'O' bowls, 70-151px) are fat and survive.
//   3. SMALL: area ≤ 120px. Long thin white highlights that are intended art
//      (water ripple gleams, 186-258px) survive even though they are thin.
//
// Same I/O contract as despeckle: near-binary monochrome RGBA in, new
// buffer out, input never mutated. Pure core — no I/O, no globals.

import type { RawImageData } from './trace-image';

const INK_LUMA_MAX = 128;
const RGBA_CHANNELS = 4;
// Audit-derived caps (see fill-pinholes.test.ts header): cracks measured
// 1-2px wide and 2-82px area; the nearest real features are 8px-wide
// counters (radius ≥ 4) and 186px ripples.
const PINHOLE_MAX_RADIUS_PX = 1;
const PINHOLE_MAX_AREA_PX = 120;

/** pixelScale: supersampling factor of the mask relative to the source
 *  image. The caps are calibrated in SOURCE pixels (from the arch-house
 *  audit), so a 2x-supersampled trace scales the radius cap by 2 and the
 *  area cap by 4 to keep the same real-space semantics. */
export function fillPinholes(image: RawImageData, pixelScale = 1): RawImageData {
  if (!isValidMonochrome(image)) return image;
  const scale = Number.isFinite(pixelScale) && pixelScale >= 1 ? pixelScale : 1;
  const { width, height } = image;
  const ink = inkMap(image);
  const outside = floodOutsideBackground(ink, width, height);
  const data = new Uint8ClampedArray(image.data);
  fillEnclosedPinholes(data, ink, outside, width, height, {
    maxAreaPx: PINHOLE_MAX_AREA_PX * scale * scale,
    maxRadiusPx: PINHOLE_MAX_RADIUS_PX * scale,
  });
  return { width, height, data };
}

type PinholeCaps = { readonly maxAreaPx: number; readonly maxRadiusPx: number };

// Scan every enclosed white component once; fill those under both caps.
function fillEnclosedPinholes(
  data: Uint8ClampedArray,
  ink: Uint8Array,
  outside: Uint8Array,
  width: number,
  height: number,
  caps: PinholeCaps,
): void {
  const seen = new Uint8Array(width * height);
  for (let start = 0; start < ink.length; start += 1) {
    if (!isUnvisitedEnclosedWhite(ink, outside, seen, start)) continue;
    const component = collectComponent(ink, outside, seen, width, height, start);
    if (component.length > caps.maxAreaPx) continue;
    if (!isHairlineThin(component, ink, width, height, caps.maxRadiusPx)) continue;
    paintComponentInk(data, component);
  }
}

function isUnvisitedEnclosedWhite(
  ink: Uint8Array,
  outside: Uint8Array,
  seen: Uint8Array,
  i: number,
): boolean {
  return (ink[i] ?? 1) === 0 && (outside[i] ?? 1) === 0 && (seen[i] ?? 1) === 0;
}

function paintComponentInk(data: Uint8ClampedArray, component: ReadonlyArray<number>): void {
  for (const pixel of component) {
    const base = pixel * RGBA_CHANNELS;
    data[base] = 0;
    data[base + 1] = 0;
    data[base + 2] = 0;
    data[base + 3] = 255;
  }
}

function isValidMonochrome(image: RawImageData): boolean {
  return (
    Number.isInteger(image.width) &&
    Number.isInteger(image.height) &&
    image.width > 0 &&
    image.height > 0 &&
    image.data.length === image.width * image.height * RGBA_CHANNELS
  );
}

function inkMap(image: RawImageData): Uint8Array {
  const ink = new Uint8Array(image.width * image.height);
  for (let pixel = 0; pixel < ink.length; pixel += 1) {
    ink[pixel] = (image.data[pixel * RGBA_CHANNELS] ?? 255) < INK_LUMA_MAX ? 1 : 0;
  }
  return ink;
}

// Flood the background reachable from any border pixel (4-connected).
// Everything white that this flood cannot reach is enclosed by ink.
function floodOutsideBackground(ink: Uint8Array, width: number, height: number): Uint8Array {
  const outside = new Uint8Array(width * height);
  const stack: number[] = [];
  for (let x = 0; x < width; x += 1) {
    stack.push(x, (height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    stack.push(y * width, y * width + width - 1);
  }
  while (stack.length > 0) {
    const pixel = stack.pop();
    if (pixel === undefined) break;
    if ((outside[pixel] ?? 1) === 1 || (ink[pixel] ?? 1) === 1) continue;
    outside[pixel] = 1;
    pushNeighbours(stack, pixel, width, height);
  }
  return outside;
}

function collectComponent(
  ink: Uint8Array,
  outside: Uint8Array,
  seen: Uint8Array,
  width: number,
  height: number,
  start: number,
): number[] {
  const component: number[] = [];
  const stack = [start];
  seen[start] = 1;
  while (stack.length > 0) {
    const pixel = stack.pop();
    if (pixel === undefined) break;
    component.push(pixel);
    const before = stack.length;
    pushNeighbours(stack, pixel, width, height);
    for (let i = stack.length - 1; i >= before; i -= 1) {
      const neighbour = stack[i];
      if (
        neighbour === undefined ||
        (seen[neighbour] ?? 1) === 1 ||
        (ink[neighbour] ?? 1) === 1 ||
        (outside[neighbour] ?? 1) === 1
      ) {
        stack.splice(i, 1);
        continue;
      }
      seen[neighbour] = 1;
    }
  }
  return component;
}

// Max inscribed radius via multi-source BFS from the ink-adjacent rim
// inward. A sliver ≤ ~2px wide never gets past depth 1 (at pixelScale 1).
function isHairlineThin(
  component: ReadonlyArray<number>,
  ink: Uint8Array,
  width: number,
  height: number,
  maxRadiusPx: number,
): boolean {
  const inComponent = new Set(component);
  const depth = new Map<number, number>();
  let frontier: number[] = [];
  for (const pixel of component) {
    if (hasInkNeighbour(pixel, ink, width, height)) {
      depth.set(pixel, 1);
      frontier.push(pixel);
    }
  }
  let maxDepth = frontier.length > 0 ? 1 : Number.POSITIVE_INFINITY;
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const pixel of frontier) {
      const d = depth.get(pixel) ?? 1;
      const scratch: number[] = [];
      pushNeighbours(scratch, pixel, width, height);
      for (const neighbour of scratch) {
        if (!inComponent.has(neighbour) || depth.has(neighbour)) continue;
        depth.set(neighbour, d + 1);
        maxDepth = Math.max(maxDepth, d + 1);
        if (maxDepth > maxRadiusPx) return false;
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return depth.size === component.length && maxDepth <= maxRadiusPx;
}

function hasInkNeighbour(pixel: number, ink: Uint8Array, width: number, height: number): boolean {
  const scratch: number[] = [];
  pushNeighbours(scratch, pixel, width, height);
  return scratch.some((neighbour) => (ink[neighbour] ?? 0) === 1);
}

function pushNeighbours(stack: number[], pixel: number, width: number, height: number): void {
  const x = pixel % width;
  if (x > 0) stack.push(pixel - 1);
  if (x < width - 1) stack.push(pixel + 1);
  if (pixel >= width) stack.push(pixel - width);
  if (pixel < width * (height - 1)) stack.push(pixel + width);
}
