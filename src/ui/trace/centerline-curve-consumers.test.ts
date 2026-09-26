// ADR-405: centreline traces now carry open (and closed) cubic subpaths. The
// laser move conditioning, the compile flattening and the CNC fairing must all
// accept them and keep the stroke's ends where the tracer put them.

import { describe, expect, it } from 'vitest';
import { sCurveArt, letterAArt } from '../../__fixtures__/centerline-stroke-art';
import { compilationPolylines } from '../../core/job/compilation-polylines';
import { IDENTITY_TRANSFORM, type ColoredPath, type Transform, type Vec2 } from '../../core/scene';
import { TRACE_PRESETS, type TraceOptions } from '../../core/trace';
import { traceImageToColoredPaths } from '../../core/trace/trace-to-paths';
import { fairTracedPathsForCnc } from './cnc-trace-fairing';
import { simplifyTracedPathsForLaser } from './laser-trace-moves';

// 254 DPI import default: one trace pixel is 0.1 mm.
const PLACEMENT: Transform = { ...IDENTITY_TRANSFORM, scaleX: 0.1, scaleY: 0.1 };
const CENTERLINE = TRACE_PRESETS['Centerline'] as TraceOptions;

async function trace(): Promise<ColoredPath[]> {
  const paths = [
    ...(await traceImageToColoredPaths(sCurveArt().image, CENTERLINE)),
    ...(await traceImageToColoredPaths(letterAArt().image, CENTERLINE)),
  ];
  expect(paths.flatMap((p) => p.curves ?? []).some((c) => !c.closed)).toBe(true);
  return paths;
}

function ends(path: ColoredPath): Vec2[] {
  return (path.curves ?? []).flatMap((curve) => [curve.start, curve.segments.at(-1)?.to as Vec2]);
}

describe('centreline cubic subpaths downstream', () => {
  it('laser conditioning keeps the cubics and compile flattens them end to end', async () => {
    const paths = await trace();
    const laser = simplifyTracedPathsForLaser(paths, PLACEMENT);
    laser.forEach((path, index) => {
      const source = paths[index] as ColoredPath;
      expect(path.curves).toEqual(source.curves);
      const compiled = compilationPolylines(path, PLACEMENT);
      expect(compiled).toHaveLength(path.curves?.length ?? 0);
      compiled.forEach((polyline, i) => {
        const curve = path.curves?.[i];
        expect(polyline.closed).toBe(curve?.closed);
        expect(polyline.points[0]).toEqual(curve?.start);
        expect(polyline.points.at(-1)).toEqual(curve?.segments.at(-1)?.to);
        // Flattening at the machine tolerance: a few moves per cubic, not the
        // tracer's pixel lattice.
        expect(polyline.points.length).toBeLessThan(200);
      });
    });
  });

  it('CNC fairing accepts the traced strokes and keeps their open ends', async () => {
    const paths = await trace();
    const faired = fairTracedPathsForCnc(paths, PLACEMENT);
    faired.forEach((path, index) => {
      expect(path.polylines).toHaveLength(path.curves?.length ?? -1);
      for (const polyline of path.polylines) {
        expect(polyline.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(
          true,
        );
      }
      const before = ends(paths[index] as ColoredPath);
      for (const end of ends(path)) {
        const nearest = Math.min(...before.map((b) => Math.hypot(b.x - end.x, b.y - end.y)));
        expect(nearest).toBeLessThan(0.51); // within the 0.05 mm fairing budget
      }
    });
  });
});
