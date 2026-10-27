import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_OPTIMIZATION, type Vec2 } from '../scene';
import type { CutGroup, CutSegment } from './job';
import { optimizePaths } from './optimize-paths';
import { configuredSegmentOrder } from './segment-order';

type Tagged = CutSegment & { readonly id: string };
const origin: Vec2 = { x: 0, y: 0 };

function rectangle(id: string, x: number, y: number, w: number, h: number): Tagged {
  return {
    id,
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

function travel(segments: ReadonlyArray<CutSegment>, start: Vec2, park: Vec2 | null): number {
  let cursor = start;
  let total = 0;
  for (const segment of segments) {
    const first = segment.polyline[0] as Vec2;
    total += Math.hypot(first.x - cursor.x, first.y - cursor.y);
    cursor = segment.polyline[segment.polyline.length - 1] as Vec2;
  }
  return total + (park === null ? 0 : Math.hypot(park.x - cursor.x, park.y - cursor.y));
}

describe.each(['nearest', 'nearest-corner'] as const)(
  'refinement with %s starts',
  (closedShapeStart) => {
    const settings = { ...DEFAULT_PROJECT_OPTIMIZATION, closedShapeStart };

    it('keeps the shorter three-rectangle route after reselecting closed starts', () => {
      const segments = [
        rectangle('upper', 79, 184, 88, 33),
        rectangle('lower', 37, 55, 74, 16),
        rectangle('left', 2, 164, 43, 99),
      ];
      const group: CutGroup = {
        kind: 'cut',
        layerId: 'L',
        color: '#000',
        power: 50,
        speed: 1200,
        passes: 1,
        airAssist: false,
        segments,
      };
      const planned = optimizePaths({ groups: [group] }, { ...settings, insideFirst: false });
      const result = planned.groups[0] as CutGroup;
      // Independent greedy route: (37,55) -> (45,164) -> (79,184), then park.
      // Reselecting the refined route's corners used to increase this to 492.775753 mm.
      expect(travel(result.segments, origin, origin)).toBeLessThanOrEqual(
        415.26895637068554 + 1e-6,
      );
      expect(result.segments.map((s) => (s as Tagged).id).sort()).toEqual([
        'left',
        'lower',
        'upper',
      ]);
    });

    it.each([null, origin, { x: 400, y: 300 }])(
      'scores the complete route including park %j',
      (returnTo) => {
        // Vary starts and shapes deterministically; keep an independent rectangle
        // containment oracle, rather than asserting the planner's own hold data.
        let state = 20261027;
        const random = () => {
          state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
          return state / 4294967296;
        };
        for (let trial = 0; trial < 40; trial += 1) {
          const segments = Array.from({ length: 5 }, (_, i) =>
            rectangle(
              String(i),
              random() * 300,
              random() * 300,
              5 + random() * 80,
              5 + random() * 80,
            ),
          );
          segments.push(rectangle('outer', 410, 20, 80, 80), rectangle('inner', 430, 40, 10, 10));
          const start = { x: random() * 400, y: random() * 300 };
          for (const insideFirst of [false, true]) {
            const policy = { ...settings, insideFirst };
            const greedy = configuredSegmentOrder(segments, policy, start);
            for (const pinFirst of [false, true]) {
              const result = configuredSegmentOrder(segments, policy, start, {
                returnTo,
                pinFirst,
              });
              expect(travel(result, start, returnTo)).toBeLessThanOrEqual(
                travel(greedy, start, returnTo) + 1e-6,
              );
              expect(result.map((s) => s.id).sort()).toEqual(segments.map((s) => s.id).sort());
              if (pinFirst) expect(result[0]?.id).toBe(greedy[0]?.id);
              if (insideFirst)
                expect(result.findIndex((s) => s.id === 'inner')).toBeLessThan(
                  result.findIndex((s) => s.id === 'outer'),
                );
              // A valid, already planned input is also a candidate. Replanning
              // must not make it longer when its first contour is not pinned.
              if (!pinFirst) {
                const again = configuredSegmentOrder(result, policy, start, { returnTo, pinFirst });
                expect(travel(again, start, returnTo)).toBeLessThanOrEqual(
                  travel(result, start, returnTo) + 1e-6,
                );
              }
            }
          }
        }
      },
    );
  },
);
