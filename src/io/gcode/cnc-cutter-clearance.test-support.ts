// Independent cutter-footprint model for emitted CNC programs: walk the G-code,
// treat every feed move below the stock top as a cutting disk of the bit's
// radius, and measure how close that disk comes to material the job keeps.
// It reads only the emitted text and the drawn part outlines, never the
// compiler's own obstacle model, so a lead check can be judged against it.

import { pointInPolygon } from '../../core/geometry';
import type { Vec2 } from '../../core/scene';

/** A kept part in machine coordinates: its outline, minus any holes cut out of it. */
export type KeptRegion = {
  readonly name: string;
  readonly outer: ReadonlyArray<Vec2>;
  readonly holes?: ReadonlyArray<ReadonlyArray<Vec2>>;
};

type Point3 = { readonly x: number; readonly y: number; readonly z: number };

export type CuttingMove = { readonly from: Point3; readonly to: Point3; readonly line: string };

export type CutterClearance = {
  /** Smallest gap between the cutter disk and kept material; negative is a gouge. */
  readonly clearanceMm: number;
  readonly region: string;
  readonly line: string;
};

const CUTTING_Z_MM = -1e-9;
const WORD = /([A-Z])(-?\d*\.?\d+)/g;

function stripComments(line: string): string {
  return line
    .replace(/\(.*?\)/g, '')
    .replace(/;.*$/, '')
    .trim()
    .toUpperCase();
}

function wordsOf(code: string): Map<string, number[]> {
  const words = new Map<string, number[]>();
  for (const match of code.matchAll(WORD)) {
    const letter = match[1] as string;
    words.set(letter, [...(words.get(letter) ?? []), Number(match[2])]);
  }
  return words;
}

function motionMode(gWords: ReadonlyArray<number>, previous: number | null): number | null {
  if (gWords.includes(2) || gWords.includes(3)) {
    throw new Error('The clearance model does not follow arcs; expected linear CNC output.');
  }
  if (gWords.includes(91)) throw new Error('The clearance model expects absolute coordinates.');
  if (gWords.includes(0)) return 0;
  if (gWords.includes(1)) return 1;
  return previous;
}

type WalkState = { readonly position: Point3; readonly mode: number | null };

// The move a line commands from `state`, or null for a line with no XYZ word.
// G53 moves are machine-frame retracts and parks; G4 is a dwell.
function lineMove(raw: string, state: WalkState): { next: Point3; mode: number | null } | null {
  const code = stripComments(raw);
  if (code === '') return null;
  const words = wordsOf(code);
  const gWords = words.get('G') ?? [];
  if (gWords.includes(53) || gWords.includes(4)) return null;
  const mode = motionMode(gWords, state.mode);
  const [x, y, z] = ['X', 'Y', 'Z'].map((axis) => words.get(axis)?.[0]);
  if (x === undefined && y === undefined && z === undefined) return { next: state.position, mode };
  const { position } = state;
  return { next: { x: x ?? position.x, y: y ?? position.y, z: z ?? position.z }, mode };
}

/** Every linear feed move whose path reaches below the stock top. */
export function cuttingMoves(gcode: string): ReadonlyArray<CuttingMove> {
  const moves: CuttingMove[] = [];
  let state: WalkState = { position: { x: 0, y: 0, z: 0 }, mode: null };
  for (const raw of gcode.split(/\r?\n/)) {
    const move = lineMove(raw, state);
    if (move === null) continue;
    const { position } = state;
    if (move.mode === 1 && Math.min(position.z, move.next.z) < CUTTING_Z_MM) {
      if (move.next !== position) moves.push({ from: position, to: move.next, line: raw.trim() });
    }
    state = { position: move.next, mode: move.mode };
  }
  return moves;
}

function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function orientation(a: Vec2, b: Vec2, c: Vec2): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  return (
    orientation(a, b, c) * orientation(a, b, d) < 0 &&
    orientation(c, d, a) * orientation(c, d, b) < 0
  );
}

function segmentSegmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
}

function segmentRingDistance(a: Vec2, b: Vec2, ring: ReadonlyArray<Vec2>): number {
  let best = Infinity;
  for (let index = 0; index < ring.length; index += 1) {
    const c = ring[index] as Vec2;
    const d = ring[(index + 1) % ring.length] as Vec2;
    best = Math.min(best, segmentSegmentDistance(a, b, c, d));
  }
  return best;
}

function insideRegion(point: Vec2, region: KeptRegion): boolean {
  return (
    pointInPolygon(point, region.outer) &&
    !(region.holes ?? []).some((hole) => pointInPolygon(point, hole))
  );
}

// A centre path that touches the region boundary or lies inside it is at
// least a full radius deep; one that stays outside clears by distance - r.
function moveClearance(move: CuttingMove, region: KeptRegion, radiusMm: number): number {
  const rings = [region.outer, ...(region.holes ?? [])];
  const distance = Math.min(...rings.map((ring) => segmentRingDistance(move.from, move.to, ring)));
  if (distance === 0 || insideRegion(move.from, region)) return -radiusMm;
  return distance - radiusMm;
}

/** The worst approach of the cutter disk to any kept region across all cutting moves. */
export function minimumCutterClearance(
  moves: ReadonlyArray<CuttingMove>,
  regions: ReadonlyArray<KeptRegion>,
  radiusMm: number,
): CutterClearance {
  let worst: CutterClearance = { clearanceMm: Infinity, region: '', line: '' };
  for (const move of moves) {
    for (const region of regions) {
      const clearanceMm = moveClearance(move, region, radiusMm);
      if (clearanceMm < worst.clearanceMm) {
        worst = { clearanceMm, region: region.name, line: move.line };
      }
    }
  }
  return worst;
}
