import { expect, it } from 'vitest';
import { vcarveMedialPasses } from './vcarve-medial';

it.each([30, 60, 90, 120])(
  'keeps emitted %s degree V-carve chords inside an independent rectangular cutter envelope',
  (angle) => {
    const width = 6,
      height = 3,
      radius = 1.5;
    const plan = vcarveMedialPasses(
      [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: width, y: 0 },
            { x: width, y: height },
            { x: 0, y: height },
          ],
        },
      ],
      {
        tool: { id: 'v', name: 'V', kind: 'v-bit', diameterMm: radius * 2, tipAngleDeg: angle },
        depthPerPassMm: 0.5,
        maxDepthMm: 4,
        resolutionMm: 0.25,
      },
    );
    expect(plan.offsetFailed).toBe(false);
    expect(plan.passes.length).toBeGreaterThan(0);
    const tan = Math.tan((angle * Math.PI) / 360);
    let samples = 0;
    for (const pass of plan.passes) {
      if (pass.kind !== 'path3d') continue;
      const emitted = pass.points.map((p) => ({
        x: Number(p.x.toFixed(3)),
        y: Number(p.y.toFixed(3)),
        z: Number(p.z.toFixed(3)),
      }));
      for (let index = 1; index < emitted.length; index += 1) {
        const a = emitted[index - 1],
          b = emitted[index];
        if (a === undefined || b === undefined) continue;
        for (let step = 0; step <= 32; step += 1) {
          const t = step / 32;
          const x = a.x + t * (b.x - a.x),
            y = a.y + t * (b.y - a.y),
            z = a.z + t * (b.z - a.z);
          const boundaryDistance = Math.min(x, width - x, y, height - y);
          const maximumDepth = Math.max(0, Math.min(boundaryDistance / tan, radius / tan, 4));
          expect(boundaryDistance).toBeGreaterThanOrEqual(-1e-9);
          expect(z).toBeGreaterThanOrEqual(-maximumDepth - 1e-9);
          expect(z).toBeLessThanOrEqual(1e-9);
          samples += 1;
        }
      }
    }
    expect(samples).toBeGreaterThan(100);
  },
);
