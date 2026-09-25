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
// Paper connectivity follows the contour walker (saddle-connectivity.ts):
// two diagonally-touching paper pixels are one region exactly when the
// walker joins paper at that corner. Without a policy, and under the
// explicit 'connect-paper' rollback, paper stays four-connected: that is the
// pre-ADR-395 flood (and the Centerline pairing with its eight-connected
// ink), so 'connect-paper' reproduces the old pipeline exactly.
//
// Same I/O contract as despeckle: near-binary monochrome RGBA in, new
// buffer out, input never mutated. Pure core — no I/O, no globals.

import type { RawImageData } from './trace-image';
import {
  createSaddleResolver,
  type SaddlePolicyInput,
  type SaddleResolver,
} from './saddle-connectivity';

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
 *  area cap by 4 to keep the same real-space semantics.
 *  judge: the automatic small-mark policy (small-mark-policy.ts). When
 *  given, a component that passes all three guards is filled only if the
 *  judge also says it is a threshold crack rather than a genuine hole. */
export function fillPinholes(
  image: RawImageData,
  pixelScale = 1,
  saddlePolicy?: SaddlePolicyInput,
  judge?: PinholeJudge,
): RawImageData {
  if (!isValidMonochrome(image)) return image;
  const scale = Number.isFinite(pixelScale) && pixelScale >= 1 ? pixelScale : 1;
  const { width, height } = image;
  const ink = inkMap(image);
  const grid: PaperGrid = {
    ink,
    width,
    height,
    inkJoinsAt:
      saddlePolicy === undefined || saddlePolicy.turnPolicy === 'connect-paper'
        ? null
        : createSaddleResolver(
            { width, height, ink },
            saddlePolicy.turnPolicy,
            saddlePolicy.field,
            saddlePolicy.pixelScale,
          ),
  };
  const outside = floodOutsideBackground(grid);
  const data = new Uint8ClampedArray(image.data);
  fillEnclosedPinholes(data, grid, outside, {
    maxAreaPx: PINHOLE_MAX_AREA_PX * scale * scale,
    maxRadiusPx: PINHOLE_MAX_RADIUS_PX * scale,
    judge,
  });
  return { width, height, data };
}

/** true = fill this enclosed thin paper component. */
export type PinholeJudge = (component: ReadonlyArray<number>) => boolean;

type PinholeCaps = {
  readonly maxAreaPx: number;
  readonly maxRadiusPx: number;
  readonly judge: PinholeJudge | undefined;
};

// The binary ink map plus the saddle decision for diagonal paper steps
// (null = paper never steps diagonally).
type PaperGrid = {
  readonly ink: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly inkJoinsAt: SaddleResolver | null;
};

// Scan every enclosed white component once; fill those under both caps.
function fillEnclosedPinholes(
  data: Uint8ClampedArray,
  grid: PaperGrid,
  outside: Uint8Array,
  caps: PinholeCaps,
): void {
  const { ink, width, height } = grid;
  const seen = new Uint8Array(width * height);
  for (let start = 0; start < ink.length; start += 1) {
    if (!isUnvisitedEnclosedWhite(ink, outside, seen, start)) continue;
    const component = collectComponent(grid, outside, seen, start);
    if (component.length > caps.maxAreaPx) continue;
    if (!isHairlineThin(component, ink, width, height, caps.maxRadiusPx)) continue;
    if (caps.judge !== undefined && !caps.judge(component)) continue;
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

// Flood the background reachable from any border pixel (4-connected, plus
// the diagonal paper steps the saddle policy joins). Everything white that
// this flood cannot reach is enclosed by ink.
function floodOutsideBackground(grid: PaperGrid): Uint8Array {
  const { ink, width, height } = grid;
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
    pushPaperNeighbours(stack, pixel, grid);
  }
  return outside;
}

function collectComponent(
  grid: PaperGrid,
  outside: Uint8Array,
  seen: Uint8Array,
  start: number,
): number[] {
  const { ink } = grid;
  const component: number[] = [];
  const stack = [start];
  seen[start] = 1;
  while (stack.length > 0) {
    const pixel = stack.pop();
    if (pixel === undefined) break;
    component.push(pixel);
    const before = stack.length;
    pushPaperNeighbours(stack, pixel, grid);
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

// Four-neighbours, plus each diagonal paper neighbour whose shared corner is
// a saddle the policy resolves in favour of paper. (A diagonal whose corner
// is not a saddle is already reachable through a paper four-neighbour.)
function pushPaperNeighbours(stack: number[], pixel: number, grid: PaperGrid): void {
  const { ink, width, height, inkJoinsAt } = grid;
  pushNeighbours(stack, pixel, width, height);
  if (inkJoinsAt === null) return;
  const x = pixel % width;
  const y = (pixel - x) / width;
  for (const [sx, sy] of DIAGONAL_STEPS) {
    const nx = x + sx;
    const ny = y + sy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    if (paperJoinsDiagonally(ink, width, x, y, nx, ny, inkJoinsAt)) stack.push(ny * width + nx);
  }
}

// Paper (x,y) → paper (nx,ny) across a saddle whose two other pixels are ink.
function paperJoinsDiagonally(
  ink: Uint8Array,
  width: number,
  x: number,
  y: number,
  nx: number,
  ny: number,
  inkJoinsAt: SaddleResolver,
): boolean {
  if ((ink[ny * width + nx] ?? 1) === 1) return false;
  if ((ink[y * width + nx] ?? 0) !== 1 || (ink[ny * width + x] ?? 0) !== 1) return false;
  return !inkJoinsAt(Math.max(x, nx), Math.max(y, ny));
}

const DIAGONAL_STEPS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

function pushNeighbours(stack: number[], pixel: number, width: number, height: number): void {
  const x = pixel % width;
  if (x > 0) stack.push(pixel - 1);
  if (x < width - 1) stack.push(pixel + 1);
  if (pixel >= width) stack.push(pixel - width);
  if (pixel < width * (height - 1)) stack.push(pixel + width);
}
