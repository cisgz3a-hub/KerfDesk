/**
 * T1-228: moved from core/plan so JobCompiler can order operations without
 * importing a lower pipeline stage.
 *
 * Greedy operation ordering: engrave + score first, inner cuts, outer cuts;
 * nearest-neighbor within settings-compatible groups; bbox containment for inner cuts.
 */

import type { Operation } from './Job';

export type OperationMode = 'engrave' | 'score' | 'cut';

export type ContainmentClass = 'inner' | 'outer' | 'standalone';

export interface OrderableShape {
  id: string;
  mode: OperationMode;
  boundingBox: { minX: number; minY: number; maxX: number; maxY: number };
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
  layerIndex: number;
  sceneIndex: number;
  /** Stable grouping for laser settings — shapes with different keys are not interleaved by NN. */
  settingsKey: string;
  /** Filled by compiler — restored after sort. */
  operation?: Operation;
}

const EPS = 1e-6;

export function bboxFullyContains(
  outer: { minX: number; minY: number; maxX: number; maxY: number },
  inner: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return (
    outer.minX <= inner.minX + EPS &&
    outer.minY <= inner.minY + EPS &&
    outer.maxX >= inner.maxX - EPS &&
    outer.maxY >= inner.maxY - EPS
  );
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function tiebreak(a: OrderableShape, b: OrderableShape): number {
  if (a.layerIndex !== b.layerIndex) return a.layerIndex - b.layerIndex;
  return a.sceneIndex - b.sceneIndex;
}

/** Lexicographic tiebreak for identical bounding boxes. */
function tiebreakBox(a: OrderableShape, b: OrderableShape): number {
  const tb = tiebreak(a, b);
  if (tb !== 0) return tb;
  const ba = a.boundingBox;
  const bb = b.boundingBox;
  if (ba.minX !== bb.minX) return ba.minX - bb.minX;
  if (ba.minY !== bb.minY) return ba.minY - bb.minY;
  if (ba.maxX !== bb.maxX) return ba.maxX - bb.maxX;
  return ba.maxY - bb.maxY;
}

function nearestNeighborOrder(pool: OrderableShape[], startPos: { x: number; y: number }): OrderableShape[] {
  const byKey = new Map<string, OrderableShape[]>();
  for (const s of pool) {
    const k = s.settingsKey;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(s);
  }
  const keys = [...byKey.keys()].sort((ka, kb) => {
    const ma = Math.min(...byKey.get(ka)!.map(s => s.sceneIndex));
    const mb = Math.min(...byKey.get(kb)!.map(s => s.sceneIndex));
    return ma - mb;
  });

  const out: OrderableShape[] = [];
  let pos = { ...startPos };
  for (const key of keys) {
    const q = [...byKey.get(key)!];
    while (q.length > 0) {
      let bestI = 0;
      let bestD = Infinity;
      for (let i = 0; i < q.length; i++) {
        const d = dist(pos, q[i].startPoint);
        if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && tiebreak(q[i], q[bestI]) < 0)) {
          bestD = d;
          bestI = i;
        }
      }
      const [pick] = q.splice(bestI, 1);
      out.push(pick);
      pos = { ...pick.endPoint };
    }
  }
  return out;
}

function classifyInnerCut(cutShapes: OrderableShape[], a: OrderableShape): boolean {
  for (const b of cutShapes) {
    if (b.id === a.id) continue;
    if (bboxFullyContains(b.boundingBox, a.boundingBox)) return true;
  }
  return false;
}

/** Topological: if A's bbox is inside B's, cut A before B (A more inner). Edge A → B means A before B. */
function sortInnerCutsByContainment(innerPool: OrderableShape[]): OrderableShape[] {
  const n = innerPool.length;
  if (n <= 1) return [...innerPool].sort(tiebreakBox);

  const ids = innerPool.map(s => s.id);
  const indexOf = (id: string) => ids.indexOf(id);
  const indeg = new Array(n).fill(0);
  const adj: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const A = innerPool[i];
      const B = innerPool[j];
      if (bboxFullyContains(B.boundingBox, A.boundingBox)) {
        adj[i].push(j);
        indeg[j]++;
      }
    }
  }

  const heap: number[] = [];
  for (let i = 0; i < n; i++) {
    if (indeg[i] === 0) heap.push(i);
  }
  heap.sort((ia, ib) => tiebreakBox(innerPool[ia], innerPool[ib]));

  const result: OrderableShape[] = [];
  while (heap.length > 0) {
    const i = heap.shift()!;
    result.push(innerPool[i]);
    for (const j of adj[i]) {
      indeg[j]--;
      if (indeg[j] === 0) {
        heap.push(j);
        heap.sort((ia, ib) => tiebreakBox(innerPool[ia], innerPool[ib]));
      }
    }
  }

  if (result.length !== n) {
    return [...innerPool].sort(tiebreakBox);
  }
  return result;
}

export function estimateTravelMm(shapes: OrderableShape[], start: { x: number; y: number } = { x: 0, y: 0 }): number {
  let total = 0;
  let pos = { ...start };
  for (const s of shapes) {
    total += dist(pos, s.startPoint);
    pos = { ...s.endPoint };
  }
  return total;
}

/** Original pipeline order: layer order then scene object index. */
export function sortShapesOriginalOrder(shapes: OrderableShape[]): OrderableShape[] {
  return [...shapes].sort((a, b) => {
    if (a.layerIndex !== b.layerIndex) return a.layerIndex - b.layerIndex;
    return a.sceneIndex - b.sceneIndex;
  });
}

/**
 * Group 1: engrave + score (NN within settings groups).
 * Group 2: inner cuts (containment topo).
 * Group 3: outer cuts (NN within settings groups).
 */
export function orderOperations(shapes: OrderableShape[]): OrderableShape[] {
  const engraveScore = shapes.filter(s => s.mode === 'engrave' || s.mode === 'score');
  const cuts = shapes.filter(s => s.mode === 'cut');

  const innerCuts = cuts.filter(c => classifyInnerCut(cuts, c));
  const innerSet = new Set(innerCuts.map(s => s.id));
  const outerCuts = cuts.filter(c => !innerSet.has(c.id));

  const g1 = nearestNeighborOrder(engraveScore, { x: 0, y: 0 });
  const lastG1 = g1.length ? g1[g1.length - 1].endPoint : { x: 0, y: 0 };
  const g2 = sortInnerCutsByContainment(innerCuts);
  const lastG2 = g2.length ? g2[g2.length - 1].endPoint : lastG1;
  const g3 = nearestNeighborOrder(outerCuts, lastG2);

  return [...g1, ...g2, ...g3];
}

export interface OperationOrderMetrics {
  engraveCount: number;
  scoreCount: number;
  innerCount: number;
  outerCount: number;
  travelSavedMm: number;
}

export function orderOperationsWithMetrics(
  shapes: OrderableShape[],
  logTag = '[Optimize]',
): { ordered: OrderableShape[]; metrics: OperationOrderMetrics } {
  const ordered = orderOperations(shapes);
  const original = sortShapesOriginalOrder(shapes);

  const engraveCount = ordered.filter(s => s.mode === 'engrave').length;
  const scoreCount = ordered.filter(s => s.mode === 'score').length;
  const cutShapes = shapes.filter(s => s.mode === 'cut');
  const innerCuts = cutShapes.filter(c => classifyInnerCut(cutShapes, c));
  const innerSet = new Set(innerCuts.map(s => s.id));
  const innerCount = innerCuts.length;
  const outerCount = ordered.filter(s => s.mode === 'cut' && !innerSet.has(s.id)).length;

  const travelOriginal = estimateTravelMm(original);
  const travelOptimized = estimateTravelMm(ordered);
  const travelSavedMm = Math.max(0, travelOriginal - travelOptimized);

  console.log(
    `${logTag} Reordered ${shapes.length} shapes: ${engraveCount} engrave, ${scoreCount} score, ${innerCount} inner cuts, ${outerCount} outer cuts`,
  );
  console.log(`${logTag} Estimated travel saved: ${Math.round(travelSavedMm)}mm`);

  return {
    ordered,
    metrics: { engraveCount, scoreCount, innerCount, outerCount, travelSavedMm },
  };
}
