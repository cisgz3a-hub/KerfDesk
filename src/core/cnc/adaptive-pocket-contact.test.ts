import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { AdaptiveCutterContact } from './adaptive-pocket-contact';

const R = 1.5875;

// The verifier's engagement measure for a contact arc (ADR-154 amendment of
// 2026-08-02): r * (1 - cos(arc / 2)).
function engagementOfArc(arcRad: number): number {
  return R * (1 - Math.cos(Math.min(Math.PI, arcRad) / 2));
}

function contactAfter(moves: ReadonlyArray<readonly [Vec2, Vec2]>): AdaptiveCutterContact {
  const contact = new AdaptiveCutterContact(R);
  for (const [a, b] of moves) contact.addMove(a, b);
  return contact;
}

describe('AdaptiveCutterContact', () => {
  it('measures a side cut beside an earlier pass by its leading arc', () => {
    // The earlier pass cleared |y| < r; cutting along y = s leaves the rim in
    // stock where y > r, from the leading direction round to the side.
    const s = 0.16;
    const contact = contactAfter([
      [
        { x: -20, y: 0 },
        { x: 20, y: 0 },
      ],
    ]);
    const engagement = contact.engagementMm({ x: 0, y: s }, { x: -10, y: s });
    expect(engagement).toBeCloseTo(engagementOfArc(Math.acos(1 - s / R)), 9);
  });

  it('measures a straight step into a flat wall as its depth', () => {
    // Both sides of the step are in stock: an arc of 2 acos(1 - s/r), whose
    // engagement is the step itself.
    const s = 0.16;
    const contact = contactAfter([
      [
        { x: -20, y: 0 },
        { x: 20, y: 0 },
      ],
    ]);
    expect(contact.engagementMm({ x: 0, y: s }, { x: 0, y: 0 })).toBeCloseTo(s, 9);
  });

  it('measures a slot as the cutter radius', () => {
    const contact = new AdaptiveCutterContact(R);
    expect(contact.engagementMm({ x: 5, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(R, 9);
  });

  it('finds no stock inside the entry helix and a concave wall at its edge', () => {
    const contact = new AdaptiveCutterContact(R);
    const pathRadius = 0.75 * R;
    contact.addEntry({ x: 0, y: 0 }, pathRadius);
    expect(contact.engagementMm({ x: 0.5, y: 0 }, { x: 0, y: 0 })).toBe(0);
    // Stepping out of the swept disk of radius p + r by the distance d: the rim
    // is in stock where it lies outside that disk.
    const d = 1.4;
    const swept = pathRadius + R;
    const half = Math.acos((swept * swept - d * d - R * R) / (2 * d * R));
    expect(contact.engagementMm({ x: d, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(
      engagementOfArc(2 * half),
      9,
    );
  });

  it('leaves the core of a helix wider than the cutter in stock', () => {
    const contact = new AdaptiveCutterContact(R);
    contact.addEntry({ x: 0, y: 0 }, 3 * R);
    // The helix swept 2r..4r from its centre; the cutter at the centre meets
    // the untouched core all round.
    expect(contact.engagementMm({ x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(R, 9);
  });

  it('agrees with a finely sampled rim for arbitrary earlier moves', () => {
    let seed = 20260927;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const around = (spread: number): Vec2 => ({
      x: (random() - 0.5) * spread,
      y: (random() - 0.5) * spread,
    });
    for (let trial = 0; trial < 150; trial += 1) {
      const moves = Array.from({ length: 1 + Math.floor(random() * 6) }, () => {
        const a = around(4 * R);
        return [a, { x: a.x + (random() - 0.5) * 3, y: a.y + (random() - 0.5) * 3 }] as const;
      });
      const entry = random() < 0.3 ? { centre: around(3 * R), pathRadius: random() * R } : null;
      const point = around(R);
      const moveStart = { x: point.x - random() * 1.5, y: point.y + (random() - 0.5) };
      const contact = contactAfter(moves);
      if (entry !== null) contact.addEntry(entry.centre, entry.pathRadius);
      const reference = sampledEngagement(point, moveStart, moves, entry);
      // 7200 rim samples resolve the arc to 0.05 degrees.
      expect(contact.engagementMm(point, moveStart)).toBeCloseTo(reference, 2);
    }
  });
});

// The largest run of rim samples that no earlier move, entry sweep or the
// cutter's own move so far comes strictly within r of.
function sampledEngagement(
  point: Vec2,
  moveStart: Vec2,
  moves: ReadonlyArray<readonly [Vec2, Vec2]>,
  entry: { readonly centre: Vec2; readonly pathRadius: number } | null,
): number {
  const samples = 7200;
  const inStock: boolean[] = [];
  for (let index = 0; index < samples; index += 1) {
    const angle = (index / samples) * 2 * Math.PI;
    const rim = { x: point.x + R * Math.cos(angle), y: point.y + R * Math.sin(angle) };
    const segments = [...moves, [moveStart, point] as const];
    const cleared =
      segments.some(([a, b]) => distanceToSegment(rim, a, b) < R - 1e-9) ||
      (entry !== null &&
        Math.abs(Math.hypot(rim.x - entry.centre.x, rim.y - entry.centre.y) - entry.pathRadius) <
          R - 1e-9);
    inStock.push(!cleared);
  }
  let longest = 0;
  let run = 0;
  for (let index = 0; index < 2 * samples; index += 1) {
    run = inStock[index % samples] === true ? Math.min(samples, run + 1) : 0;
    longest = Math.max(longest, run);
  }
  return engagementOfArc((longest / samples) * 2 * Math.PI);
}

function distanceToSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}
