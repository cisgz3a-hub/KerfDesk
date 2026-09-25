// Neighbourhood evidence for the automatic small-mark policy (ADR-409).
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
//     the support radius) in clean paper around its larger ones. An
//     anti-aliased drawing's own sub-floor specks come out grey (partial
//     pixel coverage) and its lone specks are rare (owl: 16 in 1 M px² of
//     paper; a dirty scan with one speck per 105 px²: 114 per 100 000 px²).
//     Unbridged dark debris near a mark says "dust here"; the mark then
//     needs a bridge to stay, whatever its size under the candidate cap.
//   * Support. A mark under the lone-mark floor stays only when its nearest
//     neighbour is a LIKE mark (another small mark: stipple, a dotted row,
//     small text) rather than a stroke. Specks closer to a stroke than to
//     any like mark are the stroke's halo (toner scatter, spatter).
//
// Everything is in source pixels scaled to the mask grid. Labelling is one
// linear pass; each query is bounded by a constant window (candidates are
// small by definition); debris is counted once into a coarse tile grid, so
// the whole module is linear in pixels.
//
// Our own design from connected-component analysis (ADR-017).

import type { CrackSubPixelField } from './contour-boundary';

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
  /** Mask px: size floor, lone-mark floor, like-mark ceiling; support radius. */
  readonly minArea: number;
  readonly isolatedMinArea: number;
  readonly likeMaxArea: number;
  readonly supportPx: number;
  readonly tilePx: number;
};

export type InkNeighbourhood = {
  /** Grey joins the region to other ink inside the support window. */
  readonly bridged: (region: ReadonlyArray<number>) => boolean;
  /** Unbridged dark debris in the region's tile and the eight around it. */
  readonly debrisAround: (region: ReadonlyArray<number>) => number;
  /** Nearest like mark and nearest stroke, edge to edge (Infinity: none
   *  within the support radius). */
  readonly support: (region: ReadonlyArray<number>) => { like: number; stroke: number };
};

type Box = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

export function createInkNeighbourhood(input: InkNeighbourhoodInput): InkNeighbourhood {
  const { width, height } = input;
  const { labels, areas, small } = labelInk(input);
  const reach = Math.floor(input.supportPx) + 1;
  const tile = Math.max(1, Math.round(input.tilePx));
  const tilesX = Math.ceil(width / tile);
  const tilesY = Math.ceil(height / tile);
  const debris = new Uint32Array(tilesX * tilesY);
  const labelOf = (p: number): number => labels[p] ?? 0;

  const bridgedFrom = (pixels: ReadonlyArray<number>, own: (p: number) => boolean): boolean =>
    input.bridgeLuma !== null &&
    hasGreyBridge(pixels, own, input, input.bridgeLuma, boundingBox(pixels, width), reach);

  for (const component of small) {
    const label = labelOf(component[0] ?? 0);
    const own = (p: number): boolean => labelOf(p) === label;
    const darkness = input.reach(component);
    const isDebris =
      component.length < input.minArea
        ? darkness >= AUTO_HARD_SPECK_REACH
        : darkness >= AUTO_DARK_SPECK_REACH &&
          !hasInkWithin(boundingBox(component, width), own, input, reach, input.supportPx);
    if (!isDebris || bridgedFrom(component, own)) continue;
    const p = component[0] ?? 0;
    const x = p % width;
    const t = Math.floor((p - x) / width / tile) * tilesX + Math.floor(x / tile);
    debris[t] = (debris[t] ?? 0) + 1;
  }

  return {
    bridged: (region) => {
      const members = new Set(region);
      return bridgedFrom(region, (p) => members.has(p));
    },
    debrisAround: (region) => {
      const p = region[0] ?? 0;
      const x = p % width;
      const tx = Math.floor(x / tile);
      const ty = Math.floor((p - x) / width / tile);
      let count = 0;
      for (let y = Math.max(0, ty - 1); y <= Math.min(tilesY - 1, ty + 1); y += 1)
        for (let x2 = Math.max(0, tx - 1); x2 <= Math.min(tilesX - 1, tx + 1); x2 += 1)
          count += debris[y * tilesX + x2] ?? 0;
      return count;
    },
    support: (region) => {
      const members = new Set(region);
      return nearestSupport(boundingBox(region, width), members, input, reach, (p) => {
        const area = areas[labelOf(p)] ?? 0;
        return area < input.minArea ? null : area < input.likeMaxArea ? 'like' : 'stroke';
      });
    },
  };
}

// Eight-connected labels and areas, plus the pixel lists of components under
// the lone-mark floor (the only ones debris counting needs).
function labelInk(input: InkNeighbourhoodInput): {
  readonly labels: Int32Array;
  readonly areas: number[];
  readonly small: number[][];
} {
  const labels = new Int32Array(input.width * input.height);
  const areas: number[] = [0];
  const small: number[][] = [];
  for (let start = 0; start < input.ink.length; start += 1) {
    if (input.ink[start] !== 1 || labels[start] !== 0) continue;
    const pixels = floodLabel(input, labels, start, areas.length);
    areas.push(pixels.length);
    if (pixels.length < input.isolatedMinArea) small.push(pixels);
  }
  return { labels, areas, small };
}

// Label the eight-connected ink component at `start`; returns its pixels.
// Inlined neighbour loops: this is the one full-image pass.
function floodLabel(
  input: InkNeighbourhoodInput,
  labels: Int32Array,
  start: number,
  label: number,
): number[] {
  const { width, height, ink } = input;
  const pixels: number[] = [];
  const stack = [start];
  labels[start] = label;
  while (stack.length > 0) {
    const p = stack.pop() ?? 0;
    pixels.push(p);
    const x = p % width;
    const y = (p - x) / width;
    const x0 = x > 0 ? x - 1 : x;
    const x1 = x < width - 1 ? x + 1 : x;
    const y1 = y < height - 1 ? y + 1 : y;
    for (let ny = y > 0 ? y - 1 : y; ny <= y1; ny += 1) {
      for (let q = ny * width + x0; q <= ny * width + x1; q += 1) {
        if (ink[q] !== 1 || labels[q] !== 0) continue;
        labels[q] = label;
        stack.push(q);
      }
    }
  }
  return pixels;
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
): { like: number; stroke: number } {
  const best = { like: Number.POSITIVE_INFINITY, stroke: Number.POSITIVE_INFINITY };
  scanWindow(box, input, reach, input.supportPx, (p, gap) => {
    if (members.has(p)) return false;
    const k = kind(p);
    if (k !== null && gap < best[k]) best[k] = gap;
    return false;
  });
  return best;
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
