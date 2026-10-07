import { expect } from 'vitest';
import { scanGcodeWords, type GcodeWordMatch } from '../core/gcode';
import type { Vec2 } from '../core/scene';

// Independent geometry/output oracle for the nested rectangle fixture.
// These helpers read emitted straight motion; they do not use compiler groups,
// containment metadata, or the production optimizer to establish expectations.
export type Owner = 'plate' | 'hole' | 'island';
export type Box = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};
type Burn = { readonly a: Vec2; readonly b: Vec2; readonly power: number; readonly feed: number };
export const boxes: Readonly<Record<Owner, Box>> = {
  plate: { minX: 10, minY: 10, maxX: 90, maxY: 90 },
  hole: { minX: 34, minY: 34, maxX: 66, maxY: 66 },
  island: { minX: 42, minY: 42, maxX: 58, maxY: 58 },
};
type BurnState = { at: Vec2; motion: number; power: number; feed: number; enabled: boolean };

function applyModalWord(state: BurnState, { letter, value }: GcodeWordMatch) {
  switch (letter) {
    case 'G':
      if ([2, 3, 20, 91].includes(value))
        throw new Error('Fixture requires absolute-mm straight motion.');
      if ([0, 1].includes(value)) state.motion = value;
      break;
    case 'M':
      if ([3, 4, 5].includes(value)) state.enabled = value !== 5;
      break;
    case 'S':
      state.power = value;
      break;
    case 'F':
      state.feed = value;
      break;
  }
}

/** Small independent reader for this emitted absolute-mm G0/G1 fixture only. */
export function burns(gcode: string): Burn[] {
  const out: Burn[] = [];
  const state: BurnState = { at: { x: 0, y: 0 }, motion: 0, power: 0, feed: 0, enabled: false };
  expect(gcode).toMatch(/^G21$/m);
  expect(gcode).toMatch(/^G90$/m);
  for (const raw of gcode.split('\n')) {
    const words = scanGcodeWords(raw.split(';')[0]?.replace(/\([^)]*\)/g, '') ?? '');
    for (const word of words) applyModalWord(state, word);
    const coordinates = new Map(words.map((word) => [word.letter, word.value]));
    const next = { x: coordinates.get('X') ?? state.at.x, y: coordinates.get('Y') ?? state.at.y };
    if (
      state.motion === 1 &&
      state.enabled &&
      state.power > 0 &&
      (next.x !== state.at.x || next.y !== state.at.y)
    ) {
      out.push({ a: state.at, b: next, power: state.power, feed: state.feed });
    }
    state.at = next;
  }
  return out;
}

function inside(p: Vec2, box: Box) {
  return p.x > box.minX && p.x < box.maxX && p.y > box.minY && p.y < box.maxY;
}
function onBoundary(p: Vec2, box: Box) {
  const epsilon = 1e-6;
  return (
    p.x >= box.minX - epsilon &&
    p.x <= box.maxX + epsilon &&
    p.y >= box.minY - epsilon &&
    p.y <= box.maxY + epsilon &&
    (Math.abs(p.x - box.minX) < epsilon ||
      Math.abs(p.x - box.maxX) < epsilon ||
      Math.abs(p.y - box.minY) < epsilon ||
      Math.abs(p.y - box.maxY) < epsilon)
  );
}
export const burnLength = (edge: Burn) => Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y);

function material(gcode: string) {
  return burns(gcode).flatMap((edge) => {
    const times = [0, 1];
    for (const box of Object.values(boxes))
      for (const axis of ['x', 'y'] as const) {
        const change = edge.b[axis] - edge.a[axis];
        if (change === 0) continue;
        for (const boundary of axis === 'x' ? [box.minX, box.maxX] : [box.minY, box.maxY]) {
          const t = (boundary - edge.a[axis]) / change;
          if (t > 0 && t < 1) times.push(t);
        }
      }
    times.sort((a, b) => a - b);
    return times.slice(1).flatMap((to, index) => {
      const from = times[index]!;
      if (to - from < 1e-9) return [];
      const t = (to + from) / 2;
      const p = {
        x: edge.a.x + t * (edge.b.x - edge.a.x),
        y: edge.a.y + t * (edge.b.y - edge.a.y),
      };
      // Boundary-only hatch rows and Line contours have no positive-area
      // interior here. Every other subinterval is qualified, including closures.
      if (Object.values(boxes).some((box) => onBoundary(p, box))) return [];
      const owner = !inside(p, boxes.plate)
        ? 'outside'
        : !inside(p, boxes.hole)
          ? 'plate'
          : inside(p, boxes.island)
            ? 'island'
            : 'void';
      return [
        { owner, power: edge.power, feed: edge.feed, length: burnLength(edge) * (to - from) },
      ];
    });
  });
}

export function expectFill(gcode: string, outer: number, inner = 800, feed = 1200) {
  const intervals = material(gcode);
  expect(intervals.filter((edge) => edge.owner === 'void' || edge.owner === 'outside')).toEqual([]);
  for (const [owner, power, speed] of [
    ['plate', outer, feed],
    ['island', inner, 1200],
  ] as const) {
    const owned = intervals.filter((edge) => edge.owner === owner);
    expect(owned.length).toBeGreaterThan(0);
    expect([...new Set(owned.map((edge) => edge.power))]).toEqual([power]);
    expect([...new Set(owned.map((edge) => edge.feed))]).toEqual([speed]);
  }
  return intervals;
}
export function ownerOf(edge: Burn): Owner {
  const middle = { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 };
  const owner = (Object.entries(boxes) as [Owner, Box][]).find(([, box]) =>
    [edge.a, edge.b, middle].every((p) => onBoundary(p, box)),
  )?.[0];
  if (owner === undefined) throw new Error('Unexpected burning edge between contours.');
  return owner;
}
export function contourOrder(edges: readonly Burn[]) {
  const owners = edges.map(ownerOf);
  return owners.filter((owner, index) => owners[index - 1] !== owner);
}
export const ownedLength = (gcode: string, owner: string) =>
  material(gcode)
    .filter((edge) => edge.owner === owner)
    .reduce((sum, edge) => sum + edge.length, 0);
