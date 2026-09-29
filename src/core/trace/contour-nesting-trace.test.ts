import { describe, expect, it } from 'vitest';
import { groupSubpathsByOuterShape } from '../geometry/outer-shape-groups';
import { containmentDepths } from '../job/containment-depth';
import { type ColoredPath, type Vec2 } from '../scene';
import {
  carriedSubpathDepths,
  carriedSubpathParents,
  withoutSubpathNesting,
} from '../scene/subpath-nesting';
import { traceImageToContourColoredPaths } from './contour-trace';
import type { RawImageData, TraceOptions } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';

// ADR-531: a binary trace carries its containment forest from the pixel
// lattice. These fixtures check the forest against the drawing's own nesting,
// the orientation and order it promises, and that even-odd and nonzero fill
// the same region.

const PRESETS = ['Line Art', 'Sharp', 'Smooth'] as const;

function imageOf(
  width: number,
  height: number,
  ink: (x: number, y: number) => boolean,
): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = ink(x + 0.5, y + 0.5) ? 0 : 255;
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

function trace(image: RawImageData, preset: (typeof PRESETS)[number]): ColoredPath {
  const paths = traceImageToContourColoredPaths(image, TRACE_PRESETS[preset] as TraceOptions);
  expect(paths).toHaveLength(1);
  return paths[0] as ColoredPath;
}

const annulus =
  (cx: number, cy: number, outer: number, inner: number) =>
  (x: number, y: number): boolean => {
    const d = Math.hypot(x - cx, y - cy);
    return d < outer && d >= inner;
  };

function signedArea(points: ReadonlyArray<Vec2>): number {
  let twice = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    twice += points[j]!.x * points[i]!.y - points[i]!.x * points[j]!.y;
  }
  return twice / 2;
}

function winding(point: Vec2, ring: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[j]!;
    const b = ring[i]!;
    const side = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
    if (a.y <= point.y && b.y > point.y && side > 0) total += 1;
    else if (a.y > point.y && b.y <= point.y && side < 0) total -= 1;
  }
  return total;
}

/** The forest's promises: parents first, outers positive, holes negative,
 *  and every child inside its parent and in exactly depth-many rings. */
function expectConsistentForest(path: ColoredPath): ReadonlyArray<number> {
  const parents = carriedSubpathParents(path);
  const depths = carriedSubpathDepths(path);
  expect(parents).not.toBeNull();
  expect(depths).not.toBeNull();
  const rings = path.polylines.map((polyline) => polyline.points);
  rings.forEach((ring, index) => {
    const depth = depths![index]!;
    expect(parents![index]!).toBeLessThan(index);
    expect(signedArea(ring) > 0).toBe(depth % 2 === 0);
    // A few vertices of the ring vote on how many other rings contain it.
    const votes = [0, 1, 2].map((k) => ring[Math.floor((k * ring.length) / 3)]!);
    const counts = votes.map(
      (point) => rings.filter((other, at) => at !== index && winding(point, other) !== 0).length,
    );
    expect(counts.filter((count) => count === depth).length).toBeGreaterThanOrEqual(2);
  });
  return depths!;
}

/** Even-odd and nonzero agree at every sample of a fine grid. */
function expectFillRulesAgree(path: ColoredPath, width: number, height: number): void {
  const rings = path.polylines.map((polyline) => ({
    points: polyline.points,
    minX: Math.min(...polyline.points.map((p) => p.x)),
    maxX: Math.max(...polyline.points.map((p) => p.x)),
    minY: Math.min(...polyline.points.map((p) => p.y)),
    maxY: Math.max(...polyline.points.map((p) => p.y)),
  }));
  let disagreements = 0;
  let inked = 0;
  for (let y = 0.25; y < height; y += 0.5) {
    for (let x = 0.25; x < width; x += 0.5) {
      const windings = rings.map((ring) =>
        x < ring.minX || x > ring.maxX || y < ring.minY || y > ring.maxY
          ? 0
          : winding({ x, y }, ring.points),
      );
      const total = windings.reduce((sum, w) => sum + w, 0);
      const crossings = windings.reduce((sum, w) => sum + Math.abs(w), 0);
      if (total !== 0) inked += 1;
      if ((total !== 0) !== (crossings % 2 === 1)) disagreements += 1;
    }
  }
  expect(inked).toBeGreaterThan(0);
  expect(disagreements).toBe(0);
}

describe('traced containment forest (ADR-531)', () => {
  it.each(PRESETS)('%s: six nested square bands carry depths 0..5, outers first', (preset) => {
    const image = imageOf(64, 64, (x, y) => {
      const band = Math.floor(Math.max(Math.abs(x - 32), Math.abs(y - 32)) / 4);
      return band <= 5 && band % 2 === 1;
    });
    const path = trace(image, preset);
    const depths = expectConsistentForest(path);
    expect([...depths]).toEqual([0, 1, 2, 3, 4, 5]);
    expectFillRulesAgree(path, 64, 64);
  });

  it.each(PRESETS)('%s: B, 8 and @ glyph topologies', (preset) => {
    // 8: two fused rings, one outer with two counters.
    const eight = (x: number, y: number): boolean =>
      (annulus(20, 18, 11, 5)(x, y) || annulus(20, 38, 11, 5)(x, y)) &&
      !(Math.hypot(x - 20, y - 18) < 5 || Math.hypot(x - 20, y - 38) < 5);
    // B: a stem with two bowls, two rectangular counters.
    const bee = (x: number, y: number): boolean =>
      x >= 44 &&
      x < 66 &&
      y >= 8 &&
      y < 50 &&
      !(x >= 50 && x < 60 && ((y >= 14 && y < 25) || (y >= 32 && y < 44)));
    // @: a ring around an 'a' (a ring with its own counter): depths 0..3.
    const at = (x: number, y: number): boolean =>
      annulus(96, 29, 22, 16)(x, y) || annulus(96, 29, 10, 5)(x, y);
    const image = imageOf(124, 58, (x, y) => eight(x, y) || bee(x, y) || at(x, y));
    const path = trace(image, preset);
    const depths = expectConsistentForest(path);
    expect([...depths].sort()).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 2, 3]);
    // Break Apart: 8, B, the @ ring, and the 'a' inside its hole.
    const groups = groupSubpathsByOuterShape(path);
    expect(groups.map((group) => group.length).sort()).toEqual([2, 2, 3, 3]);
    expectFillRulesAgree(path, 124, 58);
  });

  it.each(PRESETS)('%s: islands inside holes', (preset) => {
    const image = imageOf(60, 60, (x, y) => {
      const frame =
        x >= 6 && x < 54 && y >= 6 && y < 54 && !(x >= 12 && x < 48 && y >= 12 && y < 48);
      const dots = [
        [20, 20],
        [40, 22],
        [30, 40],
      ].some(([cx, cy]) => Math.hypot(x - cx!, y - cy!) < 4);
      return frame || dots;
    });
    const path = trace(image, preset);
    const depths = expectConsistentForest(path);
    expect([...depths]).toEqual([0, 1, 2, 2, 2]);
    expect(groupSubpathsByOuterShape(path).map((group) => group.length)).toEqual([2, 1, 1, 1]);
    expectFillRulesAgree(path, 60, 60);
  });

  it('a thin hollow C: the vertex probe and the carried forest both find the hole', () => {
    // An outlined C: a C-shaped ink band whose C-shaped hole ends inside it.
    const angleOk = (x: number, y: number, mouthDeg: number): boolean =>
      Math.abs((Math.atan2(y - 32, x - 32) * 180) / Math.PI) > mouthDeg;
    const image = imageOf(64, 64, (x, y) => {
      const d = Math.hypot(x - 32, y - 32);
      const ink = d >= 13 && d < 27 && angleOk(x, y, 35);
      const hole = d >= 17 && d < 23 && angleOk(x, y, 48);
      return ink && !hole;
    });
    const path = trace(image, 'Line Art');
    const depths = expectConsistentForest(path);
    expect([...depths]).toEqual([0, 1]);
    const segments = path.polylines.map((polyline) => ({
      polyline: polyline.points,
      closed: true,
    }));
    // The hole's bounds centre lies in the C's mouth, outside the outline, so
    // the old bounds-centre probe read the hole as a second outer. The probe
    // now uses a vertex of the hole, which is inside the outline.
    expect(containmentDepths(segments)).toEqual([0, 1]);
    // With the carried forest the hole is inside its outline.
    const carried = segments.map((segment, index) => ({
      ...segment,
      nesting: { forest: 'c', depth: depths[index]! },
    }));
    expect(containmentDepths(carried)).toEqual([0, 1]);
    expectFillRulesAgree(path, 64, 64);
  });

  // Three full traces of a 120 px field: well past the default 5 s on a busy runner.
  it(
    'a dense blob field: forest consistent, fill rules agree, Break Apart unchanged',
    { timeout: 60_000 },
    () => {
      let state = 7;
      const next = (): number => {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0;
        return state / 4294967296;
      };
      const blobs = [
        // Two wide rings, so blobs land inside holes inside holes.
        { x: 42, y: 44, r: 40, hole: 0.8 },
        { x: 82, y: 80, r: 34, hole: 0.75 },
        ...Array.from({ length: 60 }, () => ({
          x: next() * 120,
          y: next() * 120,
          r: 2.5 + next() * 6,
          hole: next() * 0.6,
        })),
      ];
      const image = imageOf(120, 120, (x, y) => {
        let covers = 0;
        for (const blob of blobs) {
          const d = Math.hypot(x - blob.x, y - blob.y);
          if (d < blob.r && d >= blob.r * blob.hole) covers += 1;
        }
        return covers % 2 === 1;
      });
      for (const preset of PRESETS) {
        const path = trace(image, preset);
        const depths = expectConsistentForest(path);
        // Smooth's larger speckle floor drops the smallest islands.
        expect(Math.max(...depths)).toBeGreaterThanOrEqual(preset === 'Smooth' ? 1 : 2);
        expect(depths.length).toBeGreaterThan(20);
        expectFillRulesAgree(path, 120, 120);
        // The carried forest and the probe vote agree on this drawing.
        expect(groupSubpathsByOuterShape(path)).toEqual(
          groupSubpathsByOuterShape(withoutSubpathNesting(path)),
        );
      }
    },
  );
});
