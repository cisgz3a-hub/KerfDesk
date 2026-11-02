// Neighbourhood evidence for the automatic small-mark policy (ADR-434).
//
// A dark mark's tone cannot tell a stipple dot from a toner speck: both are
// ink-black. What differs is what surrounds them, and the policy reads three
// things from the pre-erasure mask and the pre-threshold luma:
//
//   * Bridge. Anti-aliased hatching and stipple that the cut broke into
//     pieces stay joined to the rest of the drawing through grey: a path of
//     pixels at least AUTO_BRIDGE_FRACTION of the ink-paper span darker than
//     the paper leads from the mark to other ink within the support window
//     (owl, 1254²: 87% of the 3-11 px² marks that pass the tone tests).
//     Dust, toner scatter and separately drawn dots sit in clean paper and
//     have none.
//   * Debris. A dirty scan scatters dark specks of EVERY size, so it leaves
//     sub-floor specks (under the size floor) and lone specks (no ink within
//     the support radius) in clean paper around its larger ones. A sub-floor
//     speck within two pixels of a letter is that letter's own piece instead
//     (a 1-bit tittle, a tail's tip): it is not debris. An
//     anti-aliased drawing's own sub-floor specks come out grey (partial
//     pixel coverage) and its lone specks are rare (owl: 16 in 1 M px² of
//     paper; a dirty scan with one speck per 105 px²: 114 per 100 000 px²).
//     Unbridged dark debris near a mark says "dust here"; the mark then
//     needs a bridge to stay, whatever its size under the candidate cap.
//   * Support. A mark under the lone-mark floor stays only when its nearest
//     neighbour is a LIKE mark (another small mark: stipple, a dotted row,
//     small text) rather than a stroke, or when it is about as wide as the
//     stroke it faces (a tittle, a full stop). Specks closer to a stroke than
//     to any like mark and finer than it are the stroke's halo (toner
//     scatter, spatter).
//   * Coverage. Debris is sized by the ink a speck carries, as the policy's
//     floors are, so an anti-aliased dot that a floor keeps is not counted as
//     dust; and no mark is counted as dust against itself (Amendment 3).
//   * Text line. A lone dot on the baseline of a letter nearby, at whatever
//     angle the text runs, is a full stop; so is one just past a descender,
//     and a like dot straight above either is a colon's: none is a lone speck
//     (small-mark-text-line.ts).
//
// Everything is in source pixels scaled to the mask grid. Labelling is one
// linear pass; each query is bounded by a constant window (candidates are
// small by definition); debris is counted once into a coarse tile grid, so
// the whole module is linear in pixels.
//
// Our own design from connected-component analysis (ADR-017).

import type { CrackSubPixelField } from './contour-boundary';
import { createTextLine, type LabelBoxes } from './small-mark-text-line';

/** A size within this many mask px under a floor is AT the floor: coverage
 *  is a floating-point sum, and a hard 3 px² dot on the 3x grid sums to
 *  26.999999999999989 against 27 (ADR-434 Amendment 3). */
export const FLOOR_TOLERANCE_PX = 1e-6;

/** true = a mark of this size (mask px) is under the floor. */
export function underFloor(size: number, floor: number): boolean {
  return size < floor - FLOOR_TOLERANCE_PX;
}

/** Other small marks up to this many source px² count as like marks. */
export const AUTO_LIKE_MARK_MAX_AREA_PX = 32;
/** A bridge pixel must be this fraction of the ink-paper span below paper. */
export const AUTO_BRIDGE_FRACTION = 0.1;
/** Reach (fraction of the span) that makes a lone speck dark debris. */
export const AUTO_DARK_SPECK_REACH = 0.5;
/** Reach that makes a sub-floor speck hard debris: a genuine mark that
 *  small covers only part of its pixels and comes out grey. */
export const AUTO_HARD_SPECK_REACH = 0.9;
/** Debris is counted in tiles of this many source px; a mark sees its own
 *  tile and the eight around it. */
export const AUTO_DEBRIS_TILE_PX = 16;

export type InkNeighbourhoodInput = {
  readonly width: number;
  readonly height: number;
  readonly ink: Uint8Array;
  readonly field: CrackSubPixelField | null;
  /** Luma at or below which a paper pixel carries a bridge; null = none. */
  readonly bridgeLuma: number | null;
  /** How far a component's darkest pixel gets from paper to the ink tone,
   *  as a fraction of the span (1 without a grey field). */
  readonly reach: (pixels: ReadonlyArray<number>) => number;
  /** A component's size in mask px, its pixel count or, when larger, the ink
   *  it carries: the size the floors judge, as the policy's own do. */
  readonly size: (pixels: ReadonlyArray<number>) => number;
  /** Mask px: size floor, lone-mark floor, like-mark ceiling; support radius;
   *  one source pixel. */
  readonly minArea: number;
  readonly isolatedMinArea: number;
  readonly likeMaxArea: number;
  readonly supportPx: number;
  readonly tilePx: number;
  readonly sourcePx: number;
};

export type InkNeighbourhood = {
  /** Grey joins the region to other ink inside the support window. */
  readonly bridged: (region: ReadonlyArray<number>) => boolean;
  /** Unbridged dark debris in the region's tile and the eight around it,
   *  the region itself left out. */
  readonly debrisAround: (region: ReadonlyArray<number>) => number;
  /** A compact, solid dot on the baseline of a letter nearby (a full stop),
   *  just past a descender, or a colon's other dot. */
  readonly onTextLine: (region: ReadonlyArray<number>) => boolean;
  /** A dot straight above a dot on a baseline, however small. */
  readonly colonDot: (region: ReadonlyArray<number>) => boolean;
  /** Nearest like mark and nearest stroke, edge to edge (Infinity: none
   *  within the support radius), and that stroke's local width (mask px). */
  readonly support: (region: ReadonlyArray<number>) => Support;
};

export type Support = {
  readonly like: number;
  readonly stroke: number;
  /** The stroke's width where the mark faces it (mask px; see localWidth);
   *  Infinity without a stroke. */
  readonly strokeWidth: number;
};

type Box = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

export function createInkNeighbourhood(input: InkNeighbourhoodInput): InkNeighbourhood {
  const { width, height } = input;
  const { labels, areas, boxes, small } = labelInk(input);
  const reach = Math.floor(input.supportPx) + 1;
  const tile = Math.max(1, Math.round(input.tilePx));
  const tilesX = Math.ceil(width / tile);
  const tilesY = Math.ceil(height / tile);
  const debris = new Uint32Array(tilesX * tilesY);
  // The tile each debris component was counted in, by label, so a mark is
  // never dust against itself.
  const debrisTile = new Map<number, number>();
  const labelOf = (p: number): number => labels[p] ?? 0;
  const tileOf = (p: number): readonly [number, number] => {
    const x = p % width;
    return [Math.floor(x / tile), Math.floor((p - x) / width / tile)];
  };
  const textLine = createTextLine({
    width,
    height,
    ink: input.ink,
    boxes,
    labelOf,
    areas,
    baselinePx: input.sourcePx,
  });

  const bridgedFrom = (pixels: ReadonlyArray<number>, own: (p: number) => boolean): boolean =>
    input.bridgeLuma !== null &&
    hasGreyBridge(pixels, own, input, input.bridgeLuma, boundingBox(pixels, width), reach);
  // Sized by its ink only where that can change the verdict (coverage is the
  // costly part of a dirty scan's census).
  const isLoneSpeck = (component: ReadonlyArray<number>, own: (p: number) => boolean): boolean =>
    !hasInkWithin(boundingBox(component, width), own, input, reach, input.supportPx) &&
    underFloor(input.size(component), input.isolatedMinArea) &&
    !textLine.holds(component);

  for (const component of small) {
    const label = labelOf(component[0] ?? 0);
    const own = (p: number): boolean => labelOf(p) === label;
    const darkness = input.reach(component);
    if (darkness < AUTO_DARK_SPECK_REACH) continue;
    const subFloor =
      underFloor(component.length, input.minArea) &&
      underFloor(input.size(component), input.minArea);
    const isDebris = subFloor
      ? darkness >= AUTO_HARD_SPECK_REACH &&
        !textLine.besideLetter(component) &&
        !textLine.colonDot(component)
      : isLoneSpeck(component, own);
    if (!isDebris || bridgedFrom(component, own)) continue;
    const [tx, ty] = tileOf(component[0] ?? 0);
    const t = ty * tilesX + tx;
    debris[t] = (debris[t] ?? 0) + 1;
    debrisTile.set(label, t);
  }

  return {
    bridged: (region) => {
      const members = new Set(region);
      return bridgedFrom(region, (p) => members.has(p));
    },
    debrisAround: (region) => {
      const [tx, ty] = tileOf(region[0] ?? 0);
      let count = 0;
      for (let y = Math.max(0, ty - 1); y <= Math.min(tilesY - 1, ty + 1); y += 1)
        for (let x2 = Math.max(0, tx - 1); x2 <= Math.min(tilesX - 1, tx + 1); x2 += 1)
          count += debris[y * tilesX + x2] ?? 0;
      const self = debrisTile.get(labelOf(region[0] ?? 0));
      if (self === undefined) return count;
      const sx = self % tilesX;
      const sy = (self - sx) / tilesX;
      return Math.abs(sx - tx) <= 1 && Math.abs(sy - ty) <= 1 ? count - 1 : count;
    },
    onTextLine: textLine.holds,
    colonDot: textLine.colonDot,
    support: (region) => {
      const members = new Set(region);
      const kind = (p: number): 'like' | 'stroke' | null => {
        const area = areas[labelOf(p)] ?? 0;
        return area < input.minArea ? null : area < input.likeMaxArea ? 'like' : 'stroke';
      };
      return nearestSupport(boundingBox(region, width), members, input, reach, kind, labelOf);
    },
  };
}

// Eight-connected labels, areas and boxes, plus the pixel lists of components
// under the lone-mark floor (the only ones debris counting needs).
function labelInk(input: InkNeighbourhoodInput): {
  readonly labels: Int32Array;
  readonly areas: number[];
  readonly boxes: LabelBoxes;
  readonly small: number[][];
} {
  const labels = new Int32Array(input.width * input.height);
  const stack = new Int32Array(input.width * input.height);
  const areas: number[] = [0];
  const boxes = { x0: [0], y0: [0], x1: [0], y1: [0] };
  const small: number[][] = [];
  for (let start = 0; start < input.ink.length; start += 1) {
    if (input.ink[start] !== 1 || labels[start] !== 0) continue;
    const component = floodLabel(input, { labels, stack }, start, areas.length);
    areas.push(component.area);
    boxes.x0.push(component.box.x0);
    boxes.y0.push(component.box.y0);
    boxes.x1.push(component.box.x1);
    boxes.y1.push(component.box.y1);
    if (component.pixels !== null) small.push(component.pixels);
  }
  return { labels, areas, boxes, small };
}

// Label the eight-connected ink component at `start`: its area and box, and
// its pixels in flood order while it stays under the lone-mark floor (null
// for a larger one). Inlined neighbour loops: this is the one full-image pass.
function floodLabel(
  input: InkNeighbourhoodInput,
  scratch: { readonly labels: Int32Array; readonly stack: Int32Array },
  start: number,
  label: number,
): { readonly area: number; readonly box: Box; readonly pixels: number[] | null } {
  const { width, height, ink } = input;
  const { labels, stack } = scratch;
  const pixels: number[] = [];
  const box = { x0: width, y0: height, x1: -1, y1: -1 };
  let area = 0;
  let top = 1;
  stack[0] = start;
  labels[start] = label;
  while (top > 0) {
    top -= 1;
    const p = stack[top] as number;
    area += 1;
    if (area < input.isolatedMinArea) pixels.push(p);
    const x = p % width;
    const y = (p - x) / width;
    growBox(box, x, y);
    const x0 = x > 0 ? x - 1 : x;
    const x1 = x < width - 1 ? x + 1 : x;
    const y1 = y < height - 1 ? y + 1 : y;
    for (let ny = y > 0 ? y - 1 : y; ny <= y1; ny += 1) {
      for (let q = ny * width + x0; q <= ny * width + x1; q += 1) {
        if (ink[q] !== 1 || labels[q] !== 0) continue;
        labels[q] = label;
        stack[top] = q;
        top += 1;
      }
    }
  }
  return { area, box, pixels: area < input.isolatedMinArea ? pixels : null };
}

function growBox(box: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number) {
  if (x < box.x0) box.x0 = x;
  if (x > box.x1) box.x1 = x;
  if (y < box.y0) box.y0 = y;
  if (y > box.y1) box.y1 = y;
}

function forEachNeighbour(p: number, width: number, height: number, visit: (q: number) => void) {
  const x = p % width;
  const y = (p - x) / width;
  for (let dy = -1; dy <= 1; dy += 1) {
    const ny = y + dy;
    if (ny < 0 || ny >= height) continue;
    for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx;
      if ((dx !== 0 || dy !== 0) && nx >= 0 && nx < width) visit(ny * width + nx);
    }
  }
}

// Flood from the pixels through ink and bridge-dark paper, inside the box
// grown by `reach`; true on reaching ink that is not their own.
function hasGreyBridge(
  pixels: ReadonlyArray<number>,
  own: (p: number) => boolean,
  input: InkNeighbourhoodInput,
  bridgeLuma: number,
  box: Box,
  reach: number,
): boolean {
  const { width, height, ink, field } = input;
  if (field === null) return false;
  // Cheap reject: the flood can only leave through a passable neighbour.
  if (!pixels.some((p) => hasPassableNeighbour(p, own, input, bridgeLuma, field))) return false;
  const seen = new Set(pixels);
  const queue = [...pixels];
  let found = false;
  while (queue.length > 0 && !found) {
    forEachNeighbour(queue.pop() ?? 0, width, height, (q) => {
      if (found || seen.has(q)) return;
      const x = q % width;
      const y = (q - x) / width;
      if (x < box.x0 - reach || x > box.x1 + reach || y < box.y0 - reach || y > box.y1 + reach)
        return;
      seen.add(q);
      if (ink[q] === 1) {
        if (!own(q)) found = true;
        else queue.push(q);
      } else if (field.lumaAt(x, y) <= bridgeLuma) queue.push(q);
    });
  }
  return found;
}

function hasPassableNeighbour(
  p: number,
  own: (q: number) => boolean,
  input: InkNeighbourhoodInput,
  bridgeLuma: number,
  field: CrackSubPixelField,
): boolean {
  let passable = false;
  forEachNeighbour(p, input.width, input.height, (q) => {
    if (passable || own(q)) return;
    const x = q % input.width;
    passable = input.ink[q] === 1 || field.lumaAt(x, (q - x) / input.width) <= bridgeLuma;
  });
  return passable;
}

function hasInkWithin(
  box: Box,
  own: (p: number) => boolean,
  input: InkNeighbourhoodInput,
  reach: number,
  radius: number,
): boolean {
  let found = false;
  scanWindow(box, input, reach, radius, (p) => {
    if (!own(p)) found = true;
    return found;
  });
  return found;
}

function nearestSupport(
  box: Box,
  members: ReadonlySet<number>,
  input: InkNeighbourhoodInput,
  reach: number,
  kind: (p: number) => 'like' | 'stroke' | null,
  label: (p: number) => number,
): Support {
  const best = { like: Number.POSITIVE_INFINITY, stroke: Number.POSITIVE_INFINITY };
  let strokePixel = -1;
  scanWindow(box, input, reach, input.supportPx, (p, gap) => {
    if (members.has(p)) return false;
    const k = kind(p);
    if (k === null || gap >= best[k]) return false;
    best[k] = gap;
    if (k === 'stroke') strokePixel = p;
    return false;
  });
  const strokeWidth =
    strokePixel < 0 ? Number.POSITIVE_INFINITY : localWidth(strokePixel, input, label);
  return { ...best, strokeWidth };
}

// A stroke's width near its pixel p: the thinnest ink run through each pixel
// of p's own component within half the support radius of p, widest wins.
// Runs through an edge, a corner or a tip cut across the stroke at a slant
// or one pixel deep; a pixel on the stroke's middle line, which lies within
// half a width of p, spans it. Widths past the search window read as its
// span (2r + 1).
function localWidth(p: number, input: InkNeighbourhoodInput, label: (q: number) => number): number {
  const { width, height, ink } = input;
  const radius = Math.max(1, Math.round(input.supportPx / 2));
  const cap = 2 * radius + 1;
  const own = label(p);
  const x = p % width;
  const y = (p - x) / width;
  let widest = 0;
  for (let ny = Math.max(0, y - radius); ny <= Math.min(height - 1, y + radius); ny += 1) {
    for (let nx = Math.max(0, x - radius); nx <= Math.min(width - 1, x + radius); nx += 1) {
      const q = ny * width + nx;
      if (ink[q] === 1 && label(q) === own) widest = Math.max(widest, thinnestRun(q, input, cap));
    }
  }
  return widest;
}

const RUN_DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const;

// Shortest ink run through p over the four directions, in mask px (diagonal
// steps count √2), each run capped at `cap` steps so the cost stays a
// constant window.
function thinnestRun(p: number, input: InkNeighbourhoodInput, cap: number): number {
  const { width, height, ink } = input;
  const x = p % width;
  const y = (p - x) / width;
  let thinnest = Number.POSITIVE_INFINITY;
  for (const [dx, dy] of RUN_DIRECTIONS) {
    let run = 1;
    for (const sign of [1, -1]) {
      for (let step = 1; run < cap; step += 1) {
        const nx = x + sign * step * dx;
        const ny = y + sign * step * dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || ink[ny * width + nx] !== 1) break;
        run += 1;
      }
    }
    thinnest = Math.min(thinnest, run * Math.hypot(dx, dy));
  }
  return thinnest;
}

// Visit every ink pixel whose edge gap to the box is within radius; stop
// early when visit returns true. The box distance never exceeds the true
// pixel distance, so nothing within the radius is missed.
function scanWindow(
  box: Box,
  input: InkNeighbourhoodInput,
  reach: number,
  radius: number,
  visit: (p: number, gap: number) => boolean,
): void {
  const { width, height, ink } = input;
  const radius2 = radius * radius;
  const yEnd = Math.min(height - 1, box.y1 + reach);
  const xEnd = Math.min(width - 1, box.x1 + reach);
  for (let y = Math.max(0, box.y0 - reach); y <= yEnd; y += 1) {
    const gy = edgeGap(y, box.y0, box.y1);
    for (let x = Math.max(0, box.x0 - reach); x <= xEnd; x += 1) {
      const p = y * width + x;
      if (ink[p] !== 1) continue;
      const gx = edgeGap(x, box.x0, box.x1);
      const gap2 = gx * gx + gy * gy;
      if (gap2 <= radius2 && visit(p, Math.sqrt(gap2))) return;
    }
  }
}

// Gap between pixel v and the pixel span [lo, hi] along one axis, edge to
// edge: a touching pixel (centre distance 1) has gap 0; an inside pixel 0.
function edgeGap(v: number, lo: number, hi: number): number {
  return Math.max(0, (v < lo ? lo - v : v > hi ? v - hi : 0) - 1);
}

export function boundingBox(region: ReadonlyArray<number>, width: number): Box {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const p of region) {
    const x = p % width;
    const y = (p - x) / width;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}
