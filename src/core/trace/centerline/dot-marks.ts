// Dot and round-blob fallback for centreline strokes (ADR-397).
//
// A round ink component has no stroke to follow: its medial axis is a point
// or a pixel-scale stub. The stroke pipeline either dropped it (a stub
// shorter than the minimum chain) or tip-extended the stub across the whole
// diameter, so every period, i-dot and round blob came out as a dash.
//
// A component is ROUND when its outer radius (farthest ink from its
// centroid) is close to the radius r of the disc with its area, and its
// distance-field peak shows no counter inside. Such a component becomes one
// closed circular mark centred on its centroid, of radius r/2 — the midline
// between the dot's centre and its edge. Burned on a LINE layer with
// a beam of kerf k, the mark covers the annulus r/2 ± k/2: exactly the dot
// when k = r, a solid spot whenever k ≥ r (every pen-sized dot at ordinary
// engraving scale), and a ring the size of the blob for a large blob, which
// a single-line trace cannot fill anyway. A stationary beam never fires
// (positive-motion rule), so a zero-length point mark would burn nothing;
// the circle always has length. Elongated components (dashes, strokes) and
// rings (an "o" has a large outer radius for its stroke) are not round and
// keep their strokes.

import type { CurveSubpath, Polyline, Vec2 } from '../../scene';
import { registerTraceCurve } from '../trace-curves';
import type { InkMask } from './distance-field';
import { sampleStrokeCurve } from './stroke-curve-fit';

// A component is round when its outer radius is close to the radius of a
// disc of the same area: a disc scores ~1, a square dot ~1.1, a 2:1 dash
// ~1.4. The pixel slack absorbs lattice rounding of small dots.
const ROUND_AREA_RATIO = 1.2;
const ROUND_AREA_SLACK_PX = 0.5;
// ...and when the distance field agrees there is no counter inside: a ring's
// peak distance is half its stroke, far below its outer radius, so an "o"
// (any counter wider than ~1.5 px) keeps its ring stroke.
const ROUND_INNER_RATIO = 2;
const ROUND_INNER_SLACK_PX = 1.5;
// Smallest mark radius, in source px (scaled to the working grid).
const MIN_MARK_RADIUS_PX = 0.5;
// Cubic arm for a quarter circle: 4/3·tan(π/8), max radial error 0.03%.
const QUARTER_ARM = (4 / 3) * Math.tan(Math.PI / 8);

type Component = {
  count: number;
  sumX: number;
  sumY: number;
  maxDistSq: number;
  maxOuterSq: number;
};

export type RoundInk = {
  readonly label: number;
  readonly centre: Vec2;
  /** Radius of the disc with the component's area, working px. */
  readonly radius: number;
};

/** 8-connected ink components, labelled 1..n (0 = paper). */
export function labelInkComponents(mask: InkMask): { labels: Int32Array; count: number } {
  const { width, height, ink } = mask;
  const labels = new Int32Array(width * height);
  const stack: number[] = [];
  let count = 0;
  for (let start = 0; start < ink.length; start += 1) {
    if (ink[start] !== 1 || labels[start] !== 0) continue;
    count += 1;
    labels[start] = count;
    stack.push(start);
    while (stack.length > 0) floodNeighbours(mask, labels, stack.pop() as number, count, stack);
  }
  return { labels, count };
}

function floodNeighbours(
  mask: InkMask,
  labels: Int32Array,
  index: number,
  label: number,
  stack: number[],
): void {
  const { width, height, ink } = mask;
  const x = index % width;
  const y = (index - x) / width;
  for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny += 1) {
    for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx += 1) {
      const next = ny * width + nx;
      if (ink[next] === 1 && labels[next] === 0) {
        labels[next] = label;
        stack.push(next);
      }
    }
  }
}

/** The round components of the mask (see the module comment). */
export function findRoundInk(
  mask: InkMask,
  distSq: Float64Array,
  labels: Int32Array,
  count: number,
): RoundInk[] {
  const { width } = mask;
  const components: Component[] = Array.from({ length: count + 1 }, () => ({
    count: 0,
    sumX: 0,
    sumY: 0,
    maxDistSq: 0,
    maxOuterSq: 0,
  }));
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i] as number;
    if (label === 0) continue;
    const c = components[label] as Component;
    c.count += 1;
    c.sumX += (i % width) + 0.5;
    c.sumY += Math.floor(i / width) + 0.5;
    c.maxDistSq = Math.max(c.maxDistSq, distSq[i] ?? 0);
  }
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i] as number;
    if (label === 0) continue;
    const c = components[label] as Component;
    const dx = (i % width) + 0.5 - c.sumX / c.count;
    const dy = Math.floor(i / width) + 0.5 - c.sumY / c.count;
    c.maxOuterSq = Math.max(c.maxOuterSq, dx * dx + dy * dy);
  }
  const round: RoundInk[] = [];
  for (let label = 1; label <= count; label += 1) {
    const c = components[label] as Component;
    if (c.count === 0) continue;
    // Distances run between pixel centres; the ink edge is half a pixel out.
    const inner = Math.max(0.5, Math.sqrt(c.maxDistSq) - 0.5);
    const outer = Math.sqrt(c.maxOuterSq) + 0.5;
    const areaRadius = Math.sqrt(c.count / Math.PI);
    if (outer > ROUND_AREA_RATIO * areaRadius + ROUND_AREA_SLACK_PX) continue;
    if (outer > ROUND_INNER_RATIO * inner + ROUND_INNER_SLACK_PX) continue;
    round.push({ label, centre: { x: c.sumX / c.count, y: c.sumY / c.count }, radius: areaRadius });
  }
  return round;
}

/**
 * Replace the strokes of every round component with its circular mark.
 * A polyline belongs to a component when all its points that land on ink
 * land on that component; one that bridges into other ink is a real stroke
 * and keeps the component out of the fallback.
 */
export function withDotMarks(
  polylines: ReadonlyArray<Polyline>,
  mask: InkMask,
  distSq: Float64Array,
  pixelScale: number,
): Polyline[] {
  const { labels, count } = labelInkComponents(mask);
  const round = findRoundInk(mask, distSq, labels, count);
  if (round.length === 0) return [...polylines];
  const roundLabels = new Set(round.map((r) => r.label));
  const owner = polylines.map((polyline) => ownerComponent(polyline, mask.width, labels));
  const bridged = new Set<number>();
  for (const o of owner) {
    if (o.kind === 'mixed') for (const label of o.labels) bridged.add(label);
  }
  const kept = polylines.filter((_, i) => {
    const o = owner[i];
    return !(o?.kind === 'single' && roundLabels.has(o.label) && !bridged.has(o.label));
  });
  for (const dot of round) {
    if (bridged.has(dot.label)) continue;
    kept.push(dotMark(dot.centre, Math.max(dot.radius / 2, MIN_MARK_RADIUS_PX * pixelScale)));
  }
  return kept;
}

type Owner =
  | { readonly kind: 'none' }
  | { readonly kind: 'single'; readonly label: number }
  | { readonly kind: 'mixed'; readonly labels: ReadonlySet<number> };

function ownerComponent(polyline: Polyline, width: number, labels: Int32Array): Owner {
  const height = Math.floor(labels.length / width);
  const seen = new Set<number>();
  for (const p of polyline.points) {
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const label = labels[y * width + x] as number;
    if (label !== 0) seen.add(label);
  }
  if (seen.size === 0) return { kind: 'none' };
  if (seen.size === 1) return { kind: 'single', label: [...seen][0] as number };
  return { kind: 'mixed', labels: seen };
}

/** A closed circle of four cubics, registered as its canonical curve. */
export function dotMark(centre: Vec2, radius: number): Polyline {
  const k = QUARTER_ARM * radius;
  const at = (dx: number, dy: number): Vec2 => ({ x: centre.x + dx, y: centre.y + dy });
  const curve: CurveSubpath = {
    start: at(radius, 0),
    closed: true,
    segments: [
      { kind: 'cubic', control1: at(radius, k), control2: at(k, radius), to: at(0, radius) },
      { kind: 'cubic', control1: at(-k, radius), control2: at(-radius, k), to: at(-radius, 0) },
      { kind: 'cubic', control1: at(-radius, -k), control2: at(-k, -radius), to: at(0, -radius) },
      { kind: 'cubic', control1: at(k, -radius), control2: at(radius, -k), to: at(radius, 0) },
    ],
  };
  const points = sampleStrokeCurve(curve);
  registerTraceCurve(points, curve);
  return { points, closed: true };
}
