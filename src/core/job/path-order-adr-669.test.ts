// ADR-669: part-by-part inside-first, refined routes, and the re-planned job
// start. The containment oracle here is rectangle arithmetic on the fixtures,
// never the production containment or hold modules.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_OPTIMIZATION, type Vec2 } from '../scene';
import type { CutGroup, CutSegment, Job } from './job';
import { applyJobStartPoint, jobStartPointOptions } from './job-start-point';
import { lineStartCursorForJob } from './line-start-region';
import { optimizePaths } from './optimize-paths';
import { refineRoute } from './route-refine';
import { createNearestEntryQuery } from './segment-entry-index';

type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
type Tagged = CutSegment & { readonly id: string; readonly rect: Rect };

const settings = { ...DEFAULT_PROJECT_OPTIMIZATION };

function rect(id: string, x: number, y: number, w: number, h = w): Tagged {
  const r = { x, y, w, h };
  return {
    id,
    rect: r,
    closed: true,
    polyline: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
      { x, y },
    ],
  };
}

function group(segments: ReadonlyArray<CutSegment>): CutGroup {
  return {
    kind: 'cut',
    layerId: 'L',
    color: '#000',
    power: 50,
    speed: 1200,
    passes: 1,
    airAssist: false,
    segments,
  };
}

function cutSegments(job: Job): Tagged[] {
  return job.groups.flatMap((g) => (g.kind === 'cut' ? (g.segments as Tagged[]) : []));
}

function encloses(outer: Rect, inner: Rect): boolean {
  return (
    outer !== inner &&
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h &&
    (inner.w < outer.w || inner.h < outer.h)
  );
}

function expectInsideFirst(order: ReadonlyArray<Tagged>): void {
  order.forEach((outer, at) => {
    order.forEach((inner, innerAt) => {
      if (encloses(outer.rect, inner.rect)) expect(innerAt).toBeLessThan(at);
    });
  });
}

function tour(segments: ReadonlyArray<CutSegment>, start: Vec2 = { x: 0, y: 0 }): number {
  let cursor = start;
  let total = 0;
  for (const segment of segments) {
    const first = segment.polyline[0] as Vec2;
    total += Math.hypot(first.x - cursor.x, first.y - cursor.y);
    cursor = segment.polyline.at(-1) as Vec2;
  }
  return total + Math.hypot(cursor.x - start.x, cursor.y - start.y);
}

// Parts in a row: each a 40 mm outline with two 10 mm holes.
function partsRow(count: number, y = 10, prefix = 'p'): Tagged[] {
  return Array.from({ length: count }, (_, i) => {
    const x = 10 + i * 60;
    return [
      rect(`${prefix}${i}-h0`, x + 5, y + 15, 10),
      rect(`${prefix}${i}-h1`, x + 25, y + 15, 10),
      rect(`${prefix}${i}`, x, y, 40),
    ];
  }).flat();
}

describe('inside-first, part by part', () => {
  it('cuts each part’s holes before its outline, travelling less than every hole first', () => {
    const sheet = [0, 1, 2, 3].flatMap((row) => partsRow(6, 10 + row * 60, `r${row}p`));
    const order = cutSegments(optimizePaths({ groups: [group(sheet)] }, settings));
    expect(order.map((s) => s.id).sort()).toEqual(sheet.map((s) => s.id).sort());
    expectInsideFirst(order);
    // The former depth-major route: nearest-neighbour over every hole, then
    // over every outline, from where the holes ended.
    const nearestFrom = (items: Tagged[], from: Vec2): Tagged[] => {
      const left = [...items];
      const out: Tagged[] = [];
      let cursor = from;
      while (left.length > 0) {
        const distances = left.map((s) => {
          const p = s.polyline[0] as Vec2;
          return Math.hypot(p.x - cursor.x, p.y - cursor.y);
        });
        const [next] = left.splice(distances.indexOf(Math.min(...distances)), 1);
        out.push(next as Tagged);
        cursor = next?.polyline.at(-1) as Vec2;
      }
      return out;
    };
    const holes = nearestFrom(
      sheet.filter((s) => s.id.includes('-h')),
      { x: 0, y: 0 },
    );
    const outlines = nearestFrom(
      sheet.filter((s) => !s.id.includes('-h')),
      holes.at(-1)?.polyline.at(-1) as Vec2,
    );
    expect(tour(order)).toBeLessThan(tour([...holes, ...outlines]));
  });

  it('keeps every enclosed contour before its container on random nested sheets', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            col: fc.integer({ min: 0, max: 7 }),
            row: fc.integer({ min: 0, max: 5 }),
            levels: fc.integer({ min: 1, max: 4 }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        fc.boolean(),
        (families, reverse) => {
          const seen = new Set<string>();
          const segments = families.flatMap(({ col, row, levels }) => {
            const key = `${col}:${row}`;
            if (seen.has(key)) return [];
            seen.add(key);
            return Array.from({ length: levels }, (_, depth) =>
              rect(`${key}:${depth}`, col * 50 + depth * 4, row * 50 + depth * 4, 40 - depth * 8),
            );
          });
          const source = reverse ? [...segments].reverse() : segments;
          const order = cutSegments(optimizePaths({ groups: [group(source)] }, settings));
          expect(order.map((s) => s.id).sort()).toEqual(segments.map((s) => s.id).sort());
          expectInsideFirst(order);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('holds every perforated piece of an outline back until its hole is cut', () => {
    const nesting = (contour: string, depth: number) => ({
      forest: 'run',
      depth,
      topologyContour: contour,
    });
    const piece = (points: ReadonlyArray<readonly [number, number]>): CutSegment => ({
      closed: false,
      polyline: points.map(([x, y]) => ({ x, y })),
      nesting: nesting('outline', 0),
    });
    // The outline's pieces sit next to the origin; the hole is far inside.
    const pieces = [
      piece([
        [0, 0],
        [100, 0],
      ]),
      piece([
        [100, 0],
        [100, 100],
      ]),
      piece([
        [100, 100],
        [0, 100],
      ]),
      piece([
        [0, 100],
        [0, 0],
      ]),
    ];
    const hole = { ...rect('hole', 60, 60, 10), nesting: nesting('hole', 1) };
    const order = cutSegments(optimizePaths({ groups: [group([...pieces, hole])] }, settings));
    expect(order[0]).toMatchObject({ id: 'hole' });
    expect(order).toHaveLength(5);
  });

  it('sweeps the sheet once with a cut direction, part by part', () => {
    const top = partsRow(2, 100, 't');
    const bottom = partsRow(2, 10, 'b');
    const order = cutSegments(
      optimizePaths(
        { groups: [group([...bottom, ...top])] },
        { ...settings, cutDirection: 'top-to-bottom' },
        [],
        'front-left',
      ),
    );
    expectInsideFirst(order);
    // Both top parts, holes and outlines, finish before any bottom contour.
    const lastTop = Math.max(...top.map((s) => order.findIndex((o) => o.id === s.id)));
    const firstBottom = Math.min(...bottom.map((s) => order.findIndex((o) => o.id === s.id)));
    expect(lastTop).toBeLessThan(firstBottom);
  });
});

describe('refined routes', () => {
  function squares(count: number, seed: number): Tagged[] {
    let state = seed >>> 0;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    return Array.from({ length: count }, (_, i) =>
      rect(`s${i}`, Math.round(5 + random() * 360), Math.round(5 + random() * 260), 7),
    );
  }

  it('shortens a scattered sheet’s tour back to the origin by over 10 percent', () => {
    const shapes = squares(60, 20261024);
    const greedy = cutSegments(
      optimizePaths({ groups: [group(shapes)] }, { ...settings, travelPolicy: 'source-order' }),
    );
    const planned = cutSegments(optimizePaths({ groups: [group(shapes)] }, settings));
    // Independent nearest-neighbour reference from the origin.
    const remaining = [...greedy];
    const nn: Tagged[] = [];
    let cursor = { x: 0, y: 0 };
    while (remaining.length > 0) {
      let best = 0;
      remaining.forEach((s, i) => {
        const p = s.polyline[0] as Vec2;
        const q = remaining[best]?.polyline[0] as Vec2;
        if (Math.hypot(p.x - cursor.x, p.y - cursor.y) < Math.hypot(q.x - cursor.x, q.y - cursor.y))
          best = i;
      });
      const [next] = remaining.splice(best, 1);
      nn.push(next as Tagged);
      cursor = next?.polyline.at(-1) as Vec2;
    }
    expect(planned.map((s) => s.id).sort()).toEqual(shapes.map((s) => s.id).sort());
    expect(tour(planned)).toBeLessThan(0.9 * tour(nn));
  });

  it('never makes a route longer than the order it was given', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 40 }), fc.integer(), (count, seed) => {
        const shapes = squares(count, seed);
        const planned = cutSegments(optimizePaths({ groups: [group(shapes)] }, settings));
        expect(tour(planned)).toBeLessThanOrEqual(tour(shapes) + 1e-6);
        const again = cutSegments(optimizePaths({ groups: [group(planned)] }, settings));
        expect(again).toEqual(planned);
      }),
      { numRuns: 40 },
    );
  });

  it('keeps a Line burn start’s first contour first', () => {
    const shapes = squares(30, 7);
    const region = { ...settings, lineStartRegion: 'back-right' as const };
    const job = { groups: [group(shapes)] };
    const anchor = lineStartCursorForJob(job, 'back-right', 'front-left') as Vec2;
    const planned = cutSegments(optimizePaths(job, region, [], 'front-left'));
    const nearestVertex = (s: Tagged) =>
      Math.min(...s.polyline.map((p) => Math.hypot(p.x - anchor.x, p.y - anchor.y)));
    const expected = [...shapes].sort((a, b) => nearestVertex(a) - nearestVertex(b))[0];
    expect(planned[0]?.id).toBe(expected?.id);
  });
});

describe('refineRoute', () => {
  const at = (x: number, y = 0): Vec2 => ({ x, y });

  it('never flips a closed or a non-flippable item, and respects holds', () => {
    // Unconstrained, the closed item at 10 would go first and the open item
    // would run 60 to 50. Item 0 must precede item 2, and item 1 is not
    // flippable, so the given route is already the best allowed.
    const items = [
      { entry: at(100), exit: at(100), flippable: false },
      { entry: at(50), exit: at(60), flippable: false },
      { entry: at(10), exit: at(10), flippable: false },
    ];
    const holds = { holds: [[2], [], []], heldBy: [[], [], [0]], any: true };
    const refined = refineRoute(items, { start: at(0), returnTo: null, pinFirst: false, holds });
    const order = refined?.order ?? [0, 1, 2];
    expect(order.indexOf(0)).toBeLessThan(order.indexOf(2));
    expect(refined?.flipped ?? []).not.toContain(true);
    // Without the hold and with the flip allowed, both would change.
    const free = refineRoute(
      items.map((item) => ({ ...item, flippable: true })),
      { start: at(0), returnTo: null, pinFirst: false },
    );
    expect(free?.order.indexOf(2)).toBeLessThan(free?.order.indexOf(0) ?? -1);
  });

  it('flips a flippable open item when entering from its far end is shorter', () => {
    const refined = refineRoute(
      [
        { entry: at(10), exit: at(10), flippable: false },
        { entry: at(100), exit: at(20), flippable: true },
      ],
      { start: at(0), returnTo: null, pinFirst: false },
    );
    expect(refined?.flipped[1]).toBe(true);
  });
});

describe('nearest entry eligibility', () => {
  it('skips an ineligible entry without retiring it', () => {
    const query = createNearestEntryQuery([
      { point: at(1), segmentIndex: 0, reverse: false },
      { point: at(5), segmentIndex: 1, reverse: false },
    ]);
    const available = () => true;
    expect(query(at(0), available, (index) => index !== 0)?.segmentIndex).toBe(1);
    expect(query(at(0), available)?.segmentIndex).toBe(0);
  });

  function at(x: number): Vec2 {
    return { x, y: 0 };
  }
});

describe('job start point', () => {
  it('re-plans the rest of the route from the chosen contour', () => {
    const shapes = Array.from({ length: 6 }, (_, r) =>
      Array.from({ length: 8 }, (_, c) => rect(`${c}:${r}`, 10 + c * 45, 10 + r * 45, 30)),
    ).flat();
    const planned = optimizePaths({ groups: [group(shapes)] }, settings);
    const started = applyJobStartPoint(planned, { x: 360, y: 260 }, jobStartPointOptions(settings));
    const order = cutSegments(started);
    expect(order).toHaveLength(48);
    const [first, second] = order;
    expect(first?.id).toBe('7:5');
    // The second contour is next door, not back at the origin.
    const hop = Math.hypot(
      (second?.rect.x ?? 0) - (first?.rect.x ?? 0),
      (second?.rect.y ?? 0) - (first?.rect.y ?? 0),
    );
    expect(hop).toBeLessThanOrEqual(45);
  });

  it('may start inside-first work at any part’s hole, not only the deepest contours', () => {
    const shapes = [
      rect('outer', 0, 0, 200),
      rect('island-hole', 10, 10, 50),
      rect('island', 20, 20, 10),
      rect('hole', 150, 150, 20),
    ];
    const planned = optimizePaths({ groups: [group(shapes)] }, settings);
    const started = applyJobStartPoint(planned, { x: 160, y: 150 }, jobStartPointOptions(settings));
    const order = cutSegments(started);
    expect(order[0]?.id).toBe('hole');
    expectInsideFirst(order);
  });
});
