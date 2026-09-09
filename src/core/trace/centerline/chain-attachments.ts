import type { Vec2 } from '../../scene';
import { type TraceSteps } from '../trace-steps';
import type { Chain } from './junction-pairing';
import { decideLoopClosure, type LoopClosureOptions } from './loop-closure';
import { projectOntoSegment } from './polyline-window';
import { SegmentGrid, type GridSegment } from './spatial-grid';

type Attachments = Map<Chain, Set<Vec2>>;
type Insertions = Map<number, Map<number, Vec2[]>>;
type AttachmentState = {
  readonly anchors: Attachments;
  readonly insertions: Insertions;
  readonly parents: Map<Vec2, Vec2>;
};

// This is floating-point incidence, not a geometric joining distance. The
// existing weld stage decides which ends join. Here we only retain contacts
// already present in its output, including an end touching its own loop.
function coincident(a: Vec2, b: Vec2): boolean {
  const magnitude = Math.max(1, Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y));
  return Math.hypot(a.x - b.x, a.y - b.y) <= 32 * Number.EPSILON * magnitude;
}

/** Insert shared vertices at established endpoint/segment contacts. All
 * affected chains receive the same anchor object, so later changes can pin
 * the attachment without turning the through-stroke into a drawn corner. */
export function* retainChainAttachmentsSteps(
  chains: ReadonlyArray<Chain>,
): TraceSteps<Attachments> {
  const cooperate = yield;
  const grid = yield* attachmentGridSteps(chains);
  const state: AttachmentState = { anchors: new Map(), insertions: new Map(), parents: new Map() };
  for (let ownerId = 0; ownerId < chains.length; ownerId += 1) {
    if (cooperate) yield;
    const chain = chains[ownerId];
    if (chain === undefined || !chain.alive || chain.closed || chain.points.length < 2) continue;
    for (const index of [0, chain.points.length - 1]) {
      collectEndpointContacts(chain, ownerId, index, grid, state, chains);
    }
  }
  for (const [ownerId, segments] of state.insertions) {
    const chain = chains[ownerId] as Chain;
    chain.points = insertAnchors(chain.points, segments, state.parents);
  }
  for (const [chain, anchors] of state.anchors) {
    chain.points = chain.points.map((point) => canonical(state.parents, point));
    state.anchors.set(chain, new Set([...anchors].map((point) => canonical(state.parents, point))));
  }
  return state.anchors;
}

function* attachmentGridSteps(chains: ReadonlyArray<Chain>): TraceSteps<SegmentGrid> {
  const cooperate = yield;
  const grid = new SegmentGrid(4);
  for (let ownerId = 0; ownerId < chains.length; ownerId += 1) {
    if (cooperate) yield;
    const chain = chains[ownerId];
    if (chain === undefined || !chain.alive) continue;
    const count = chain.points.length - (chain.closed ? 0 : 1);
    for (let segIndex = 0; segIndex < count; segIndex += 1) {
      const a = chain.points[segIndex];
      const b = chain.points[(segIndex + 1) % chain.points.length];
      if (a !== undefined && b !== undefined) grid.insert({ ownerId, segIndex, a, b });
    }
  }
  return grid;
}

function collectEndpointContacts(
  chain: Chain,
  ownerId: number,
  index: number,
  grid: SegmentGrid,
  state: AttachmentState,
  chains: ReadonlyArray<Chain>,
): void {
  const point = chain.points[index] as Vec2;
  const adjacent = index === 0 ? 0 : index - 1;
  const seen = new Set<GridSegment>();
  const reach = 32 * Number.EPSILON * Math.max(1, Math.abs(point.x), Math.abs(point.y));
  for (const segment of grid.query(point, reach)) {
    if (seen.has(segment)) continue;
    seen.add(segment);
    if (segment.ownerId === ownerId && segment.segIndex === adjacent) continue;
    if (!coincident(point, projectOntoSegment(point, segment.a, segment.b))) continue;
    const target = chains[segment.ownerId] as Chain;
    addAnchor(state.anchors, chain, point);
    addAnchor(state.anchors, target, point);
    if (coincident(point, segment.a)) unite(state.parents, point, segment.a);
    else if (coincident(point, segment.b)) unite(state.parents, point, segment.b);
    else addInsertion(state.insertions, segment, point);
  }
}

function addAnchor(attachments: Attachments, chain: Chain, point: Vec2): void {
  const anchors = attachments.get(chain) ?? new Set<Vec2>();
  anchors.add(point);
  attachments.set(chain, anchors);
}

function addInsertion(insertions: Insertions, segment: GridSegment, point: Vec2): void {
  const chain = insertions.get(segment.ownerId) ?? new Map<number, Vec2[]>();
  const points = chain.get(segment.segIndex) ?? [];
  points.push(point);
  chain.set(segment.segIndex, points);
  insertions.set(segment.ownerId, chain);
}

function canonical(parents: Map<Vec2, Vec2>, point: Vec2): Vec2 {
  let root = point;
  let parent = parents.get(root);
  while (parent !== undefined && parent !== root) {
    root = parent;
    parent = parents.get(root);
  }
  parents.set(point, root);
  return root;
}

function unite(parents: Map<Vec2, Vec2>, a: Vec2, b: Vec2): void {
  const first = canonical(parents, a);
  const second = canonical(parents, b);
  if (first !== second) parents.set(second, first);
}

function insertAnchors(
  points: ReadonlyArray<Vec2>,
  insertions: ReadonlyMap<number, Vec2[]>,
  parents: Map<Vec2, Vec2>,
): Vec2[] {
  const result: Vec2[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i] as Vec2;
    result.push(point);
    const inserted = insertions.get(i);
    if (inserted === undefined) continue;
    inserted.sort(
      (a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y),
    );
    for (const anchor of inserted) {
      const previous = result.at(-1) as Vec2;
      if (coincident(previous, anchor)) unite(parents, previous, anchor);
      else result.push(anchor);
    }
  }
  return result;
}

/** Split only for simplification: each shared attachment becomes a retained
 * endpoint of a Douglas-Peucker span. The full chain is rejoined before
 * interpolation, which still has both neighbours at smooth attachments. */
export function attachmentSpans(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  anchors: ReadonlySet<Vec2>,
  farthest: number,
): Vec2[][] {
  const breaks = new Set([0, closed ? farthest : points.length - 1]);
  points.forEach((point, index) => {
    if (anchors.has(point)) breaks.add(index);
  });
  const indices = [...breaks].sort((a, b) => a - b);
  const source = closed ? [...points, points[0] as Vec2] : points;
  if (closed) indices.push(points.length);
  return indices.slice(1).map((end, index) => source.slice(indices[index], end + 1));
}

export function applyChainLoopClosure(
  chain: Chain,
  closure: LoopClosureOptions,
  anchors?: ReadonlySet<Vec2>,
): void {
  const decision = decideLoopClosure(chain.points, closure);
  if (decision.kind === 'open') return;
  const last = chain.points.at(-1);
  // A touching-but-distinct last point may carry another branch. Only the
  // duplicate occurrence of the very same shared anchor can be discarded.
  if (
    decision.dropLastPoint &&
    (last === undefined || !anchors?.has(last) || last === chain.points[0])
  )
    chain.points.pop();
  chain.closed = true;
}
