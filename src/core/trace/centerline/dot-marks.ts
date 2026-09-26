// Dot and round-blob fallback for centreline strokes (ADR-405).
//
// A round ink component has no stroke to follow: its medial axis is a point
// or a pixel-scale stub. The stroke pipeline either dropped it (a stub
// shorter than the minimum chain) or tip-extended the stub across the whole
// diameter, so every period, i-dot and round blob came out as a dash.
//
// A component is a DOT only when two independent kinds of evidence agree:
//
//  * shape — it is compact (its outer radius is close to the radius of the
//    disc with its area, so no concavity or open counter) and not elongated
//    (the axis ratio of its second moments is at most 1.2, so a 1.4:1
//    capsule is already a stroke);
//  * skeleton — its own medial axis is degenerate: no junction, at most one
//    open chain, and that chain no longer than the outer radius exceeds the
//    inscribed radius (plus lattice slack). A dash, a plus sign or a small
//    "e" with an open counter has a real skeleton and keeps its strokes.
//
// A dot becomes concentric closed circles centred on its centroid, spaced at
// most one source pixel apart: n = ceil(r / pitch) circles at radii
// (2j + 1)·r / (2n). Burned on a LINE layer with a beam of kerf k, circle j
// covers its radius ± k/2, so the circles tile the disc of radius r exactly
// when k = r / n and cover it solid for any k ≥ r / n — any beam at least one
// source pixel wide (0.1 mm at the 254 DPI import default). A dot no wider
// than a pixel gets one circle of radius r/2. A stationary beam never fires
// (positive-motion rule), so a zero-length point mark would burn nothing;
// every circle has length.

import type { CurveSubpath, Polyline, Vec2 } from '../../scene';
import { registerTraceCurve } from '../trace-curves';
import type { InkMask } from './distance-field';
import { arcLength } from './spur-pruning';
import type { StrokeGraph } from './stroke-graph';
import { sampleStrokeCurve } from './stroke-curve-fit';

// Shape: the outer radius is close to the radius of a disc of the same area
// (a disc scores ~1, a square dot ~1.1, a "C" or a ring far more). The slack
// absorbs lattice rounding of small dots. Every px constant here is a SOURCE
// pixel distance, scaled to the working grid, so an auto-upscaled trace
// classifies the same ink the same way.
const ROUND_AREA_RATIO = 1.2;
const ROUND_AREA_SLACK_PX = 0.5;
// Shape: second-moment axis ratio. A pixelated disc measures ~1.0; a 7x5
// capsule (1.4:1) measures 1.25 and an 8x5 one 1.39.
const MAX_AXIS_RATIO = 1.2;
// Skeleton: a dot's medial stub is at most as long as its outer radius
// exceeds its inscribed radius, plus this lattice slack.
const SKELETON_SLACK_PX = 1.5;
// Concentric-circle pitch and the smallest circle drawn, source px.
const RING_PITCH_PX = 1;
const MIN_RING_RADIUS_PX = 0.25;
// Cubic arm for a quarter circle: 4/3·tan(π/8), max radial error 0.03%.
const QUARTER_ARM = (4 / 3) * Math.tan(Math.PI / 8);

type Component = {
  count: number;
  sumX: number;
  sumY: number;
  sumXX: number;
  sumYY: number;
  sumXY: number;
  maxDistSq: number;
  maxOuterSq: number;
  junctions: number;
  chains: number;
  closedChains: number;
  longestChain: number;
};

type Dot = {
  readonly label: number;
  readonly centre: Vec2;
  /** Radius of the disc with the component's area, working px. */
  readonly radius: number;
};

/**
 * Replace the strokes of every dot component with its concentric circles.
 * `skeleton` is the pruned stroke graph the strokes were assembled from. A
 * polyline belongs to a component when all its points that land on ink land
 * on that component; one that bridges into other ink is a real stroke and
 * keeps the component out of the fallback.
 */
export function withDotMarks(
  polylines: ReadonlyArray<Polyline>,
  mask: InkMask,
  distSq: Float64Array,
  skeleton: StrokeGraph,
  pixelScale: number,
): Polyline[] {
  const { labels, count } = labelInkComponents(mask);
  const dots = findDots(mask, distSq, labels, count, skeleton, pixelScale);
  if (dots.length === 0) return [...polylines];
  const dotLabels = new Set(dots.map((d) => d.label));
  const owner = polylines.map((polyline) => ownerComponent(polyline, mask.width, labels));
  const bridged = new Set<number>();
  for (const o of owner) {
    if (o.kind === 'mixed') for (const label of o.labels) bridged.add(label);
  }
  const kept = polylines.filter((_, i) => {
    const o = owner[i];
    return !(o?.kind === 'single' && dotLabels.has(o.label) && !bridged.has(o.label));
  });
  for (const dot of dots) {
    if (bridged.has(dot.label)) continue;
    kept.push(...dotMarks(dot.centre, dot.radius, pixelScale));
  }
  return kept;
}

/** Concentric circles that burn a dot of radius `radius` (working px) solid
 *  with any beam at least one source pixel wide (see the module comment). */
function dotMarks(centre: Vec2, radius: number, pixelScale: number): Polyline[] {
  const scale = Math.max(1e-6, pixelScale);
  const n = Math.max(1, Math.ceil(radius / (RING_PITCH_PX * scale) - 1e-9));
  const marks: Polyline[] = [];
  for (let j = n - 1; j >= 0; j -= 1) {
    const r = Math.max(((2 * j + 1) * radius) / (2 * n), MIN_RING_RADIUS_PX * scale);
    marks.push(circleMark(centre, r));
  }
  return marks;
}

// 8-connected ink components, labelled 1..n (0 = paper).
function labelInkComponents(mask: InkMask): { labels: Int32Array; count: number } {
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

// The dot components of the mask (see the module comment).
function findDots(
  mask: InkMask,
  distSq: Float64Array,
  labels: Int32Array,
  count: number,
  skeleton: StrokeGraph,
  pixelScale: number,
): Dot[] {
  const components = measureComponents(mask, distSq, labels, count);
  addSkeletonEvidence(components, skeleton, mask.width, labels);
  const scale = Math.max(1e-6, pixelScale);
  const dots: Dot[] = [];
  for (let label = 1; label <= count; label += 1) {
    const c = components[label] as Component;
    if (c.count === 0) continue;
    // Distances run between pixel centres; the ink edge is half a pixel out.
    const inner = Math.max(0.5, Math.sqrt(c.maxDistSq) - 0.5);
    const outer = Math.sqrt(c.maxOuterSq) + 0.5;
    const areaRadius = Math.sqrt(c.count / Math.PI);
    if (outer > ROUND_AREA_RATIO * areaRadius + ROUND_AREA_SLACK_PX * scale) continue;
    if (axisRatio(c) > MAX_AXIS_RATIO) continue;
    if (c.junctions > 0 || c.closedChains > 0 || c.chains > 1) continue;
    if (c.longestChain > outer - inner + SKELETON_SLACK_PX * scale) continue;
    dots.push({ label, centre: { x: c.sumX / c.count, y: c.sumY / c.count }, radius: areaRadius });
  }
  return dots;
}

function emptyComponent(): Component {
  return {
    count: 0,
    sumX: 0,
    sumY: 0,
    sumXX: 0,
    sumYY: 0,
    sumXY: 0,
    maxDistSq: 0,
    maxOuterSq: 0,
    junctions: 0,
    chains: 0,
    closedChains: 0,
    longestChain: 0,
  };
}

function measureComponents(
  mask: InkMask,
  distSq: Float64Array,
  labels: Int32Array,
  count: number,
): Component[] {
  const { width } = mask;
  const components = Array.from({ length: count + 1 }, emptyComponent);
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i] as number;
    if (label === 0) continue;
    const c = components[label] as Component;
    const x = (i % width) + 0.5;
    const y = Math.floor(i / width) + 0.5;
    c.count += 1;
    c.sumX += x;
    c.sumY += y;
    c.sumXX += x * x;
    c.sumYY += y * y;
    c.sumXY += x * y;
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
  return components;
}

// Junctions and chains of the pruned skeleton, credited to the component
// their position lands on.
function addSkeletonEvidence(
  components: Component[],
  skeleton: StrokeGraph,
  width: number,
  labels: Int32Array,
): void {
  const componentAt = (p: Vec2 | undefined): Component | undefined => {
    if (p === undefined) return undefined;
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= width) return undefined;
    const label = labels[y * width + x] ?? 0;
    return label === 0 ? undefined : components[label];
  };
  for (const node of skeleton.nodes) {
    if (node.kind !== 'junction') continue;
    const c = componentAt(node.pos);
    if (c !== undefined) c.junctions += 1;
  }
  for (const chain of skeleton.chains) {
    const c = componentAt(chain.points[chain.points.length >> 1]);
    if (c === undefined) continue;
    c.chains += 1;
    if (chain.closed) c.closedChains += 1;
    c.longestChain = Math.max(c.longestChain, arcLength(chain.points));
  }
}

// Ratio of the principal axes of the component's second moments, each pixel
// counted as a unit square (hence the 1/12 on both variances).
function axisRatio(c: Component): number {
  const mx = c.sumX / c.count;
  const my = c.sumY / c.count;
  const vxx = c.sumXX / c.count - mx * mx + 1 / 12;
  const vyy = c.sumYY / c.count - my * my + 1 / 12;
  const vxy = c.sumXY / c.count - mx * my;
  const half = (vxx + vyy) / 2;
  const spread = Math.sqrt(((vxx - vyy) / 2) ** 2 + vxy * vxy);
  const minor = half - spread;
  return minor > 1e-12 ? Math.sqrt((half + spread) / minor) : Infinity;
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

// A closed circle of four cubics, registered as its canonical curve.
function circleMark(centre: Vec2, radius: number): Polyline {
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
