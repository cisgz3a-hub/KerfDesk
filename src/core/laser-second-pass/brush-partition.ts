import { visitBrushCandidates, type BrushIndex } from './brush-index';
import { capsuleInterval, type ParameterInterval } from './capsule-interval';
import type { LaserSecondPassSegment, LaserSecondPassStroke } from './types';

export type BrushPowerInterval = ParameterInterval & { readonly scale: number };
type BrushEvent = { readonly t: number; readonly stroke: number; readonly change: number };

function heapPush(heap: number[], value: number): void {
  let index = heap.length;
  heap.push(value);
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    const parentValue = heap[parent];
    if (parentValue === undefined || parentValue >= value) break;
    heap[index] = parentValue;
    index = parent;
  }
  heap[index] = value;
}

function heapPop(heap: number[]): void {
  const tail = heap.pop();
  if (tail === undefined || heap.length === 0) return;
  let index = 0;
  while (index * 2 + 1 < heap.length) {
    let child = index * 2 + 1;
    if ((heap[child + 1] ?? -1) > (heap[child] ?? -1)) child += 1;
    const childValue = heap[child];
    if (childValue === undefined || childValue <= tail) break;
    heap[index] = childValue;
    index = child;
  }
  heap[index] = tail;
}

function appendInterval(
  result: BrushPowerInterval[],
  start: number,
  end: number,
  scale: number,
): void {
  if (end <= start) return;
  const previous = result[result.length - 1];
  if (previous !== undefined && previous.scale === scale && previous.end === start) {
    result[result.length - 1] = { start: previous.start, end, scale };
  } else result.push({ start, end, scale });
}

function discardInactive(heap: number[], active: ReadonlyMap<number, number>): void {
  while (heap.length > 0 && (active.get(heap[0] ?? -1) ?? 0) <= 0) heapPop(heap);
}

function applyEvents(
  events: ReadonlyArray<BrushEvent>,
  start: number,
  active: Map<number, number>,
  heap: number[],
): number {
  let cursor = start;
  const t = events[start]?.t;
  while (cursor < events.length && events[cursor]?.t === t) {
    const event = events[cursor];
    cursor += 1;
    if (event === undefined) continue;
    const count = (active.get(event.stroke) ?? 0) + event.change;
    active.set(event.stroke, count);
    if (count === 1 && event.change > 0) heapPush(heap, event.stroke);
  }
  discardInactive(heap, active);
  return cursor;
}

function sweep(
  events: BrushEvent[],
  strokes: ReadonlyArray<LaserSecondPassStroke>,
): BrushPowerInterval[] {
  events.sort((a, b) => a.t - b.t || a.stroke - b.stroke || a.change - b.change);
  const active = new Map<number, number>();
  const heap: number[] = [];
  const result: BrushPowerInterval[] = [];
  let cursor = 0;
  let start = 0;
  while (cursor < events.length) {
    const t = events[cursor]?.t ?? 1;
    const owner = strokes[heap[0] ?? -1];
    appendInterval(result, start, t, owner?.mode === 'paint' ? owner.powerScale : 0);
    cursor = applyEvents(events, cursor, active, heap);
    start = t;
  }
  appendInterval(result, start, 1, 0);
  return result;
}

/** Later brush strokes override earlier ones; overlaps never add another pass. */
export function partitionBrushPower(
  segment: LaserSecondPassSegment,
  index: BrushIndex,
  strokes: ReadonlyArray<LaserSecondPassStroke>,
): ReadonlyArray<BrushPowerInterval> {
  if (segment.rapid || segment.power <= 0) return [{ start: 0, end: 1, scale: 0 }];
  const events: BrushEvent[] = [];
  const bounds = {
    minX: Math.min(segment.from.x, segment.to.x),
    minY: Math.min(segment.from.y, segment.to.y),
    maxX: Math.max(segment.from.x, segment.to.x),
    maxY: Math.max(segment.from.y, segment.to.y),
  };
  visitBrushCandidates(index, bounds, (candidate) => {
    const interval = capsuleInterval(segment.from, segment.to, candidate);
    if (interval === null) return;
    events.push({ t: interval.start, stroke: candidate.stroke, change: 1 });
    events.push({ t: interval.end, stroke: candidate.stroke, change: -1 });
  });
  return sweep(events, strokes);
}
