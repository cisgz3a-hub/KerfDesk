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
// pre-ADR-403 flood (and the Centerline pairing with its eight-connected
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
  // One stack serves every flood: each marks a pixel when it pushes it, so
  // no flood holds more than the image.
  const stack = new Int32Array(width * height);
  const outside = floodOutsideBackground(grid, stack);
  const data = new Uint8ClampedArray(image.data);
  fillEnclosedPinholes(data, new PaperFlood(grid, new Uint8Array(width * height), outside, stack), {
    maxAreaPx: PINHOLE_MAX_AREA_PX * scale * scale,
    // The inscribed radius is a whole-pixel depth, so a fractional working
    // grid (the supersample taper) rounds its cap up: a sliver of the capped
    // source width is ceil(scale) pixels deep there, and on an integer grid
    // this is the plain product.
    maxRadiusPx: Math.ceil(PINHOLE_MAX_RADIUS_PX * scale),
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
function fillEnclosedPinholes(data: Uint8ClampedArray, flood: PaperFlood, caps: PinholeCaps): void {
  const { ink, width, height } = flood.grid;
  for (let start = 0; start < ink.length; start += 1) {
    if (!flood.opens(start)) continue;
    const component = collectComponent(flood, start, caps.maxAreaPx);
    if (component === null) continue;
    if (!isHairlineThin(component, ink, width, height, caps.maxRadiusPx)) continue;
    if (caps.judge !== undefined && !caps.judge(component)) continue;
    paintComponentInk(data, component);
  }
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
function floodOutsideBackground(grid: PaperGrid, stack: Int32Array): Uint8Array {
  const { width, height } = grid;
  const outside = new Uint8Array(width * height);
  const flood = new PaperFlood(grid, outside, null, stack);
  for (let x = 0; x < width; x += 1) {
    flood.push(x);
    flood.push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    flood.push(y * width);
    flood.push(y * width + width - 1);
  }
  for (let pixel = flood.pop(); pixel >= 0; pixel = flood.pop()) flood.pushSteps(pixel);
  return outside;
}

// The enclosed paper component holding `start`, in the depth-first order it
// has always been collected in, or null once it holds more than `maxArea`
// pixels. The rest of a large component is still flooded, so no later scan
// starts inside it.
function collectComponent(flood: PaperFlood, start: number, maxArea: number): number[] | null {
  const component: number[] = [];
  let size = 0;
  flood.push(start);
  for (let pixel = flood.pop(); pixel >= 0; pixel = flood.pop()) {
    size += 1;
    if (size <= maxArea) component.push(pixel);
    flood.pushSteps(pixel);
  }
  return size > maxArea ? null : component;
}

// Which sides of a paper pixel at column `x` are ink, for its diagonal steps.
type DiagonalSides = {
  readonly x: number;
  readonly inkLeft: boolean;
  readonly inkRight: boolean;
  readonly inkJoinsAt: SaddleResolver;
};

// A depth-first flood over paper steps: four-neighbours, plus each diagonal
// paper neighbour whose shared corner is a saddle the policy resolves in
// favour of paper (a diagonal whose corner is not a saddle is already
// reachable through a paper four-neighbour). A pixel is marked when it is
// pushed, never pushed twice, and never pushed when ink or `blocked`.
class PaperFlood {
  private top = 0;

  constructor(
    readonly grid: PaperGrid,
    private readonly marks: Uint8Array,
    private readonly blocked: Uint8Array | null,
    private readonly stack: Int32Array,
  ) {}

  /** Whether a flood from `pixel` would take it: paper, unmarked, not blocked. */
  opens(pixel: number): boolean {
    return (
      this.marks[pixel] === 0 && this.grid.ink[pixel] === 0 && (this.blocked?.[pixel] ?? 0) === 0
    );
  }

  push(pixel: number): void {
    if (!this.opens(pixel)) return;
    this.marks[pixel] = 1;
    this.stack[this.top] = pixel;
    this.top += 1;
  }

  /** The most recently pushed pixel, or −1 once the flood is done. */
  pop(): number {
    if (this.top === 0) return -1;
    this.top -= 1;
    return this.stack[this.top] as number;
  }

  pushSteps(pixel: number): void {
    const { width, height, inkJoinsAt } = this.grid;
    const x = pixel % width;
    if (x > 0) this.push(pixel - 1);
    if (x < width - 1) this.push(pixel + 1);
    if (pixel >= width) this.push(pixel - width);
    if (pixel < width * (height - 1)) this.push(pixel + width);
    if (inkJoinsAt !== null) this.pushDiagonalSteps(pixel, x, inkJoinsAt);
  }

  // A diagonal paper step crosses a corner whose two other pixels are ink, so
  // only a pixel with ink on both sides of a corner has one to test. Steps go
  // up-left, up-right, down-left, down-right, as they always have.
  private pushDiagonalSteps(pixel: number, x: number, inkJoinsAt: SaddleResolver): void {
    const { width, height, ink } = this.grid;
    const inkLeft = x > 0 && ink[pixel - 1] === 1;
    const inkRight = x < width - 1 && ink[pixel + 1] === 1;
    if (!inkLeft && !inkRight) return;
    const y = (pixel - x) / width;
    const sides = { x, inkLeft, inkRight, inkJoinsAt };
    if (y > 0 && ink[pixel - width] === 1) this.pushAcrossRow(pixel - width, y, sides);
    if (y < height - 1 && ink[pixel + width] === 1) this.pushAcrossRow(pixel + width, y + 1, sides);
  }

  // The diagonal steps beside `ink`, the ink pixel above or below, across
  // corners on lattice row `cornerY`.
  private pushAcrossRow(ink: number, cornerY: number, sides: DiagonalSides): void {
    if (sides.inkLeft) this.pushAcross(ink - 1, sides.x, cornerY, sides.inkJoinsAt);
    if (sides.inkRight) this.pushAcross(ink + 1, sides.x + 1, cornerY, sides.inkJoinsAt);
  }

  // Push `target` across the saddle at lattice corner (cornerX, cornerY)
  // unless the policy joins ink there.
  private pushAcross(
    target: number,
    cornerX: number,
    cornerY: number,
    inkJoinsAt: SaddleResolver,
  ): void {
    if (this.opens(target) && !inkJoinsAt(cornerX, cornerY)) this.push(target);
  }
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
