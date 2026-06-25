// Chains skeleton edges through junctions so a glyph stroke stays ONE connected
// polyline instead of shattering into one fragment per edge (ADR-058). The
// legacy extractor walks pixels and stops at every junction, then a collinear-
// only merge tried to glue straight pieces back — which left every curved or
// bent crossing fragmented (the broken letters).
//
// A branch is a pixel path between two graph nodes. Branch ends that share a
// pixel meet at a node; where >=2 ends meet we greedily pair the two whose
// outward tangents are most antiparallel — the straightest path through the
// junction, i.e. how the pen actually moved. Unpaired ends terminate a chain;
// fully-paired components (loops, e.g. an "O") start anywhere. Deterministic:
// nodes and ends are visited in branch/raster order with first-found tie-breaks.

type Pixel = { readonly x: number; readonly y: number };
type Vec = { readonly x: number; readonly y: number };

const TANGENT_LOOKAHEAD_PX = 3;
// Branch ends within this Chebyshev distance belong to one junction node. Zhang-
// Suen leaves small (1-3px) multi-pixel junction clusters, so a crossing's edges
// terminate at different but adjacent pixels; proximity grouping (not exact
// pixel) lets them pair and chain through.
const CLUSTER_RADIUS_PX = 2;

type End = { readonly id: number; readonly x: number; readonly y: number };

export function chainBranches(branches: ReadonlyArray<ReadonlyArray<Pixel>>): Pixel[][] {
  const ends = collectEnds(branches);
  const root = clusterEnds(branches.length, ends);
  const partner = pairWithinClusters(branches, ends, root);
  return walkChains(branches, partner);
}

function endId(branch: number, end: 0 | 1): number {
  return branch * 2 + end;
}

function collectEnds(branches: ReadonlyArray<ReadonlyArray<Pixel>>): End[] {
  const out: End[] = [];
  for (let i = 0; i < branches.length; i += 1) {
    const b = branches[i];
    const first = b?.[0];
    const last = b?.[b.length - 1];
    if (first === undefined || last === undefined) continue;
    out.push({ id: endId(i, 0), x: first.x, y: first.y });
    out.push({ id: endId(i, 1), x: last.x, y: last.y });
  }
  return out;
}

function clusterEnds(branchCount: number, ends: ReadonlyArray<End>): Int32Array {
  const parent = new Int32Array(branchCount * 2);
  for (let i = 0; i < parent.length; i += 1) parent[i] = i;
  for (let i = 0; i < ends.length; i += 1) {
    for (let j = i + 1; j < ends.length; j += 1) {
      const a = ends[i];
      const b = ends[j];
      if (a === undefined || b === undefined) continue;
      if (Math.abs(a.x - b.x) <= CLUSTER_RADIUS_PX && Math.abs(a.y - b.y) <= CLUSTER_RADIUS_PX) {
        union(parent, a.id, b.id);
      }
    }
  }
  return parent;
}

function find(parent: Int32Array, i: number): number {
  let r = i;
  while ((parent[r] ?? r) !== r) r = parent[r] ?? r;
  return r;
}

function union(parent: Int32Array, a: number, b: number): void {
  const ra = find(parent, a);
  const rb = find(parent, b);
  if (ra !== rb) parent[ra] = rb;
}

function pairWithinClusters(
  branches: ReadonlyArray<ReadonlyArray<Pixel>>,
  ends: ReadonlyArray<End>,
  root: Int32Array,
): Int32Array {
  const groups = new Map<number, number[]>();
  for (const e of ends) {
    const r = find(root, e.id);
    const list = groups.get(r);
    if (list === undefined) groups.set(r, [e.id]);
    else list.push(e.id);
  }
  const partner = new Int32Array(branches.length * 2).fill(-1);
  for (const ids of groups.values()) {
    const remaining = [...ids];
    while (remaining.length >= 2) {
      const [i, j] = bestPair(branches, remaining);
      const a = remaining[i];
      const b = remaining[j];
      if (a !== undefined && b !== undefined) {
        partner[a] = b;
        partner[b] = a;
      }
      remaining.splice(j, 1);
      remaining.splice(i, 1);
    }
  }
  return partner;
}

// Index pair in `ids` whose outward tangents are most antiparallel (straightest
// through-path). First-found wins ties, for determinism.
function bestPair(branches: ReadonlyArray<ReadonlyArray<Pixel>>, ids: number[]): [number, number] {
  let bi = 0;
  let bj = 1;
  let best = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i];
      const b = ids[j];
      if (a === undefined || b === undefined) continue;
      const score = -dot(endTangent(branches, a), endTangent(branches, b));
      if (score > best) {
        best = score;
        bi = i;
        bj = j;
      }
    }
  }
  return [bi, bj];
}

function endTangent(branches: ReadonlyArray<ReadonlyArray<Pixel>>, id: number): Vec {
  const b = branches[id >> 1];
  if (b === undefined || b.length === 0) return { x: 0, y: 0 };
  if ((id & 1) === 0) return unit(b[0], b[Math.min(TANGENT_LOOKAHEAD_PX, b.length - 1)]);
  return unit(b[b.length - 1], b[Math.max(0, b.length - 1 - TANGENT_LOOKAHEAD_PX)]);
}

function unit(tip: Pixel | undefined, back: Pixel | undefined): Vec {
  if (tip === undefined || back === undefined) return { x: 0, y: 0 };
  const dx = tip.x - back.x;
  const dy = tip.y - back.y;
  const len = Math.hypot(dx, dy);
  return len === 0 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len };
}

function dot(a: Vec, b: Vec): number {
  return a.x * b.x + a.y * b.y;
}

function walkChains(branches: ReadonlyArray<ReadonlyArray<Pixel>>, partner: Int32Array): Pixel[][] {
  const used = new Uint8Array(branches.length);
  const chains: Pixel[][] = [];
  const start = (branch: number, end: 0 | 1): void => {
    const chain = walkFrom(branches, partner, used, branch, end);
    if (chain.length > 0) chains.push(chain);
  };
  for (let i = 0; i < branches.length; i += 1) {
    if (used[i] === 0 && partner[endId(i, 0)] === -1) start(i, 0);
    if (used[i] === 0 && partner[endId(i, 1)] === -1) start(i, 1);
  }
  for (let i = 0; i < branches.length; i += 1) if (used[i] === 0) start(i, 0); // loops
  return chains;
}

function walkFrom(
  branches: ReadonlyArray<ReadonlyArray<Pixel>>,
  partner: Int32Array,
  used: Uint8Array,
  startBranch: number,
  entryEnd: 0 | 1,
): Pixel[] {
  const out: Pixel[] = [];
  let branch = startBranch;
  let fromEnd: 0 | 1 = entryEnd;
  let guard = 0;
  while (branch !== -1 && used[branch] === 0 && guard <= branches.length) {
    guard += 1;
    used[branch] = 1;
    const pixels = branches[branch];
    if (pixels === undefined) break;
    appendOriented(out, pixels, fromEnd);
    const next = partner[endId(branch, fromEnd === 0 ? 1 : 0)] ?? -1;
    if (next === -1) break;
    branch = next >> 1;
    fromEnd = (next & 1) as 0 | 1;
  }
  return out;
}

// Append branch pixels traversed from `fromEnd` (0 = forward, 1 = reversed),
// skipping a leading pixel that duplicates the shared junction pixel.
function appendOriented(out: Pixel[], pixels: ReadonlyArray<Pixel>, fromEnd: 0 | 1): void {
  const n = pixels.length;
  for (let k = 0; k < n; k += 1) {
    const p = fromEnd === 0 ? pixels[k] : pixels[n - 1 - k];
    if (p === undefined) continue;
    const last = out[out.length - 1];
    if (last !== undefined && last.x === p.x && last.y === p.y) continue;
    out.push(p);
  }
}
