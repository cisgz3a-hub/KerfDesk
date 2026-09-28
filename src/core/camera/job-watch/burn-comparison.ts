// The burn check (ADR-490): did the laser mark the bed where the job said it
// would, and nowhere else? The before and after pictures give where the bed
// changed; the job's path gives where it should have. A path pixel is burned
// when a change lies within the tolerance of it (the camera model is good to
// about half a millimetre), and a change outside the path's zone is a stray
// mark once it covers at least a square millimetre. What the camera could not
// judge is hidden, never guessed: bed it did not see, the area around the
// laser head in either picture, and any change reaching the picture's edge,
// which is the gantry, a hand or the material moving (the watched area keeps
// a margin round the job, so a burn never reaches it). Pure core.

import type { RgbaImage } from '../rgba-image';
import { changeMask } from './change-mask';
import { maskComponents } from './mask-components';
import type { RouteMasks } from './route-mask';

export const BURN_TOLERANCE_MM = 1;
export const MIN_STRAY_MARK_MM2 = 1;

/** Per-pixel verdict, one byte each. */
export const BurnPixel = {
  None: 0,
  Burned: 1,
  Missed: 2,
  Stray: 3,
  Hidden: 4,
} as const;

export type Disc = { readonly x: number; readonly y: number; readonly radius: number };

export type BurnCheckInput = {
  readonly before: RgbaImage;
  readonly after: RgbaImage;
  readonly masks: RouteMasks;
  readonly pixelsPerMm: number;
  readonly toleranceMm?: number;
  /** Areas the camera cannot judge (round the laser head), in pixels. */
  readonly hiddenDiscs?: ReadonlyArray<Disc>;
};

export type BurnReport = {
  readonly pathPixels: number;
  readonly seenPathPixels: number;
  readonly burnedPathPixels: number;
  /** Share of the seen path the camera saw change; null when it saw none of the path. */
  readonly coverage: number | null;
  /** Share of the path the camera could not judge. */
  readonly hiddenShare: number;
  readonly strayMarks: number;
  readonly strayAreaMm2: number;
};

export type BurnCheck = {
  readonly report: BurnReport;
  readonly pixels: Uint8Array;
};

export function checkBurn(input: BurnCheckInput): BurnCheck {
  const { width, height } = input.masks.path;
  const { path, zone } = input.masks;
  const change = changeMask(input.before, input.after, zone.data);
  const hidden = hiddenPixels(change.seen, change.changed, width, height, input.hiddenDiscs ?? []);
  const changed = new Uint8Array(change.changed.length);
  for (let i = 0; i < changed.length; i += 1) {
    if (change.changed[i] === 1 && hidden[i] !== 1) changed[i] = 1;
  }
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i += 1) if (hidden[i] === 1) pixels[i] = BurnPixel.Hidden;
  const toleranceMm = input.toleranceMm ?? BURN_TOLERANCE_MM;
  const reach = discOffsets(toleranceMm * input.pixelsPerMm);
  const pathCounts = judgePath(path.data, changed, hidden, pixels, { width, height, reach });
  const stray = judgeStray(changed, zone.data, pixels, width, height, input.pixelsPerMm);
  return {
    report: {
      ...pathCounts,
      coverage:
        pathCounts.seenPathPixels > 0
          ? pathCounts.burnedPathPixels / pathCounts.seenPathPixels
          : null,
      hiddenShare:
        pathCounts.pathPixels > 0
          ? (pathCounts.pathPixels - pathCounts.seenPathPixels) / pathCounts.pathPixels
          : 0,
      ...stray,
    },
    pixels,
  };
}

function hiddenPixels(
  seen: Uint8Array,
  changed: Uint8Array,
  width: number,
  height: number,
  discs: ReadonlyArray<Disc>,
): Uint8Array {
  const hidden = new Uint8Array(width * height);
  for (let i = 0; i < hidden.length; i += 1) if (seen[i] !== 1) hidden[i] = 1;
  for (const disc of discs) markDisc(hidden, width, height, disc);
  const groups = maskComponents(changed, width, height);
  for (let i = 0; i < hidden.length; i += 1) {
    const label = groups.labels[i] ?? -1;
    if (label >= 0 && groups.touchesEdge[label] === true) hidden[i] = 1;
  }
  return hidden;
}

function markDisc(mask: Uint8Array, width: number, height: number, disc: Disc): void {
  const r = disc.radius;
  for (let y = Math.max(0, Math.ceil(disc.y - r)); y <= Math.min(height - 1, disc.y + r); y += 1) {
    for (let x = Math.max(0, Math.ceil(disc.x - r)); x <= Math.min(width - 1, disc.x + r); x += 1) {
      if ((x - disc.x) ** 2 + (y - disc.y) ** 2 <= r * r) mask[y * width + x] = 1;
    }
  }
}

type Offset = { readonly dx: number; readonly dy: number };

// Every pixel offset within `radius`, nearest first so a hit ends the search early.
function discOffsets(radius: number): ReadonlyArray<Offset> {
  const r = Math.max(0, radius);
  const reach = Math.floor(r);
  const offsets: Offset[] = [];
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      if (dx * dx + dy * dy <= r * r) offsets.push({ dx, dy });
    }
  }
  return offsets.sort((a, b) => a.dx ** 2 + a.dy ** 2 - (b.dx ** 2 + b.dy ** 2));
}

type PathCounts = Pick<BurnReport, 'pathPixels' | 'seenPathPixels' | 'burnedPathPixels'>;

function judgePath(
  path: Uint8Array,
  changed: Uint8Array,
  hidden: Uint8Array,
  pixels: Uint8Array,
  grid: { readonly width: number; readonly height: number; readonly reach: ReadonlyArray<Offset> },
): PathCounts {
  let pathPixels = 0;
  let seenPathPixels = 0;
  let burnedPathPixels = 0;
  for (let i = 0; i < path.length; i += 1) {
    if (path[i] !== 1) continue;
    pathPixels += 1;
    if (hidden[i] === 1) continue;
    seenPathPixels += 1;
    const burned = changeNear(changed, grid, i);
    if (burned) burnedPathPixels += 1;
    pixels[i] = burned ? BurnPixel.Burned : BurnPixel.Missed;
  }
  return { pathPixels, seenPathPixels, burnedPathPixels };
}

function changeNear(
  changed: Uint8Array,
  grid: { readonly width: number; readonly height: number; readonly reach: ReadonlyArray<Offset> },
  index: number,
): boolean {
  const x = index % grid.width;
  const y = (index - x) / grid.width;
  for (const { dx, dy } of grid.reach) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
    if (changed[ny * grid.width + nx] === 1) return true;
  }
  return false;
}

function judgeStray(
  changed: Uint8Array,
  zone: Uint8Array,
  pixels: Uint8Array,
  width: number,
  height: number,
  pixelsPerMm: number,
): Pick<BurnReport, 'strayMarks' | 'strayAreaMm2'> {
  const outside = new Uint8Array(changed.length);
  for (let i = 0; i < outside.length; i += 1) {
    if (changed[i] === 1 && zone[i] !== 1) outside[i] = 1;
  }
  const groups = maskComponents(outside, width, height);
  const minPixels = MIN_STRAY_MARK_MM2 * pixelsPerMm * pixelsPerMm;
  const counted = groups.sizes.map((size) => size >= minPixels);
  let strayPixels = 0;
  for (let i = 0; i < outside.length; i += 1) {
    const label = groups.labels[i] ?? -1;
    if (label < 0 || counted[label] !== true) continue;
    pixels[i] = BurnPixel.Stray;
    strayPixels += 1;
  }
  return {
    strayMarks: counted.filter(Boolean).length,
    strayAreaMm2: strayPixels / (pixelsPerMm * pixelsPerMm),
  };
}

// Missed path red, stray marks amber, what the camera could not judge dimmed.
const MISSED_RGB = [226, 48, 48] as const;
const STRAY_RGB = [245, 166, 35] as const;
const TINT = 0.8;
const HIDDEN_DIM = 0.45;

/** The after picture with the check's verdicts painted over it. */
export function burnCheckPicture(after: RgbaImage, pixels: Uint8Array): RgbaImage {
  const data = new Uint8ClampedArray(after.data);
  for (let i = 0; i < pixels.length; i += 1) {
    const verdict = pixels[i];
    const at = i * 4;
    if (verdict === BurnPixel.Missed) tint(data, at, MISSED_RGB, TINT);
    else if (verdict === BurnPixel.Stray) tint(data, at, STRAY_RGB, TINT);
    else if (verdict === BurnPixel.Hidden) tint(data, at, [128, 128, 128], HIDDEN_DIM);
  }
  return { data, width: after.width, height: after.height };
}

function tint(
  data: Uint8ClampedArray,
  at: number,
  rgb: readonly [number, number, number],
  amount: number,
): void {
  for (let c = 0; c < 3; c += 1) {
    data[at + c] = (data[at + c] ?? 0) * (1 - amount) + (rgb[c] ?? 0) * amount;
  }
}
