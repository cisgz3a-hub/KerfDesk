import { describe, expect, it } from 'vitest';
import type { CncTool } from '../scene';
import { cuttingSurfaceDz, kernelForTool } from './tool-kernels';
import { toolProfile } from './tool-profile';

const TOOL_CASES: readonly CncTool[] = [
  { id: 't', name: 'end-mill', kind: 'end-mill', diameterMm: 6 },
  { id: 't', name: 'ball-nose', kind: 'ball-nose', diameterMm: 6 },
  { id: 't', name: 'v-bit', kind: 'v-bit', diameterMm: 6, tipAngleDeg: 60 },
  { id: 't', name: 'v-bit', kind: 'v-bit', diameterMm: 4, tipAngleDeg: 30 },
  { id: 't', name: 'engraving', kind: 'engraving', diameterMm: 3 },
];

function tool(kind: CncTool['kind'], diameterMm: number, tipAngleDeg?: number): CncTool {
  return {
    id: 't',
    name: kind,
    kind,
    diameterMm,
    ...(tipAngleDeg === undefined ? {} : { tipAngleDeg }),
  };
}

// Linear interpolation along the sampled cutting surface, matching how the
// rendered lathe surface interpolates between profile points.
function profileHeightAt(
  profile: ReadonlyArray<{ readonly radiusMm: number; readonly heightMm: number }>,
  dMm: number,
  radiusMm: number,
): number {
  const cutting = profile.slice(0, -1);
  const clamped = Math.min(dMm, radiusMm);
  for (let index = 1; index < cutting.length; index += 1) {
    const previous = cutting[index - 1];
    const current = cutting[index];
    if (previous === undefined || current === undefined) continue;
    if (clamped <= current.radiusMm) {
      const span = current.radiusMm - previous.radiusMm;
      if (span <= 0) return previous.heightMm;
      const t = (clamped - previous.radiusMm) / span;
      return previous.heightMm + t * (current.heightMm - previous.heightMm);
    }
  }
  return cutting.at(-1)?.heightMm ?? 0;
}

describe('toolProfile', () => {
  it('gives a flat end-mill a flat bottom', () => {
    const profile = toolProfile(tool('end-mill', 6));
    const cutting = profile.slice(0, -1);

    expect(cutting.every((point) => point.heightMm === 0)).toBe(true);
    expect(cutting.at(-1)?.radiusMm).toBeCloseTo(3, 10);
  });

  it('caps a ball nose with a quarter arc of its own radius', () => {
    const radius = 3;
    const profile = toolProfile(tool('ball-nose', radius * 2));

    // Every cutting sample must sit on the sphere: r - sqrt(r^2 - d^2).
    for (const point of profile.slice(0, -1)) {
      const expected = radius - Math.sqrt(Math.max(0, radius * radius - point.radiusMm ** 2));
      expect(point.heightMm).toBeCloseTo(expected, 10);
    }
    // At full radius the cap has risen exactly one radius.
    expect(profile.at(-2)?.heightMm).toBeCloseTo(radius, 10);
  });

  it('slopes a v-bit by its tip half-angle', () => {
    const profile = toolProfile(tool('v-bit', 6, 90));
    // 90° included -> 45° half-angle -> height equals radius at the edge.
    expect(profile.at(-2)?.heightMm).toBeCloseTo(3, 10);
  });

  it('falls back to a usable v-bit angle when none is configured', () => {
    const profile = toolProfile(tool('v-bit', 6));
    const edge = profile.at(-2);

    expect(edge?.heightMm).toBeGreaterThan(0);
    expect(Number.isFinite(edge?.heightMm ?? Number.NaN)).toBe(true);
  });

  it('never lies about the tool the simulation actually used', () => {
    // The load-bearing property: the drawn silhouette and the stamping kernel
    // must be the same solid. If these ever diverge, the preview shows one bit
    // while the sim cuts another and nothing else in the suite would notice.
    //
    // Two separate claims, because they have genuinely different tolerances:
    // the profile's own points sit EXACTLY on the kernel's cutting surface,
    // while the rendered surface between them is a chord across a curve and
    // carries a small, bounded interpolation error. Asserting one loose
    // tolerance for both would hide a real divergence inside slack meant for
    // interpolation.
    for (const candidate of TOOL_CASES) {
      const radiusMm = Math.max(0.01, candidate.diameterMm / 2);
      for (const point of toolProfile(candidate).slice(0, -1)) {
        expect(point.heightMm).toBeCloseTo(
          cuttingSurfaceDz(candidate, point.radiusMm, radiusMm),
          12,
        );
      }
    }
  });

  it('keeps the drawn surface within a hair of the simulated one between samples', () => {
    // Sample radii are sin-spaced so the sphere's curvature error is spread
    // evenly rather than dumped in the last interval. With evenly-spaced radii
    // this deviation reaches 0.24 mm on a 6 mm ball nose — visible, and more
    // than a finishing pass's scallop.
    const MAX_DEVIATION_MM = 0.02;
    // Measured away from the rim, deliberately. Vertical height difference is
    // not a meaningful error metric where the surface is nearly vertical: on a
    // ball nose's rim an arbitrarily small sideways deviation shows up as a
    // large height difference, and raising the sample count does not reduce it
    // — it only moves which kernel cell lands nearest an interval's worst
    // point, so the number can even go back up. The rim is pinned separately
    // by the exactness test below.
    const RIM_EXCLUSION = 0.95;

    for (const candidate of TOOL_CASES) {
      const mmPerCell = 0.1;
      const kernel = kernelForTool(candidate, mmPerCell);
      const radiusMm = candidate.diameterMm / 2;
      const profile = toolProfile(candidate);

      for (const offset of kernel.offsets) {
        const dMm = Math.hypot(offset.dx, offset.dy) * mmPerCell;
        if (dMm > radiusMm * RIM_EXCLUSION) continue;
        const deviation = Math.abs(profileHeightAt(profile, dMm, radiusMm) - offset.dz);
        expect(deviation).toBeLessThanOrEqual(MAX_DEVIATION_MM);
      }
    }
  });

  it('passes exactly through the rim, where height is a poor error measure', () => {
    // The one point the chord test cannot police, pinned directly: full
    // radius, and risen exactly one radius.
    const radius = 3;
    const rim = toolProfile(tool('ball-nose', radius * 2)).at(-2);

    expect(rim?.radiusMm).toBeCloseTo(radius, 12);
    expect(rim?.heightMm).toBeCloseTo(radius, 12);
  });

  it('rises into a shank above the cutting surface', () => {
    const profile = toolProfile(tool('end-mill', 6));
    const shoulder = profile.at(-2);
    const shankTop = profile.at(-1);

    expect(shankTop?.heightMm ?? 0).toBeGreaterThan(shoulder?.heightMm ?? 0);
    // The shank is a straight cylinder, so it must not flare past the cutter.
    expect(shankTop?.radiusMm).toBeCloseTo(shoulder?.radiusMm ?? 0, 10);
  });

  it('produces a finite profile for a degenerate zero-diameter tool', () => {
    const profile = toolProfile(tool('end-mill', 0));

    expect(profile.length).toBeGreaterThan(1);
    expect(profile.every((p) => Number.isFinite(p.radiusMm) && Number.isFinite(p.heightMm))).toBe(
      true,
    );
  });
});
