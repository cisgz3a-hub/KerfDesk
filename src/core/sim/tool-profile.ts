// toolProfile — the cutter's silhouette, for drawing the bit in 3D.
//
// A solid of revolution is defined by its half-silhouette: rotate these
// (radius, height) points about the tool axis and you get the bit. The viewer
// feeds them straight to three's LatheGeometry.
//
// The silhouette is SAMPLED FROM cuttingSurfaceDz, the same function that
// decides how much material each kernel cell removes. That is deliberate and
// is the whole reason this module is worth having: if the profile re-derived
// the geometry independently, the preview could show a ball nose while the
// simulation cut a flat bottom, and the operator would have no way to tell.
//
// Heights are measured UP from the tool's lowest point, so height 0 is the tip
// and the caller positions the whole profile at the cutting Z.
//
// PURE: plain numbers in, plain numbers out.

import type { CncTool } from '../scene';
import { cuttingSurfaceDz } from './tool-kernels';

export type ToolProfilePoint = {
  readonly radiusMm: number;
  readonly heightMm: number;
};

// Samples across the cutting surface. A flat end-mill needs 2; a ball nose
// needs enough that the cap does not read as a faceted cone.
// 20 samples. The bound that matters is GEOMETRIC distance from the true
// surface — the sagitta of each chord, r(1-cos(Δθ/2)) ≈ 0.002 mm here — not
// vertical height difference. Vertical difference is not a meaningful measure
// near the rim of a ball nose, where the surface is very nearly vertical and
// an arbitrarily small sideways error reads as a large height error. Raising
// the count does not fix that and is not meant to: the profile's points sit
// exactly on the surface, including the rim.
const CUTTING_SURFACE_SAMPLES = 20;

// Sample radii are spaced by sin, not evenly. A ball nose's surface approaches
// vertical at the rim, so evenly-spaced radii bunch all the curvature into the
// last interval: at 12 even samples the rendered surface deviates from the
// simulated one by up to 0.24 mm near the edge, i.e. the drawn bit is not the
// bit that cut. Spacing by sin makes the samples uniform in ANGLE around the
// cap, which is exact for the flat and V profiles (both linear in radius) and
// spreads the sphere's error evenly instead of concentrating it.
function sampleRadiusMm(radiusMm: number, sample: number, sampleCount: number): number {
  return radiusMm * Math.sin((Math.PI / 2) * (sample / sampleCount));
}

// How far the shank rises above the cutting surface, as a multiple of tool
// diameter. Long enough to read as a tool rather than a floating stub.
const SHANK_LENGTH_DIAMETERS = 3;

const MIN_RADIUS_MM = 0.01;

/**
 * Builds the cutter's half-silhouette for a solid of revolution.
 *
 * @param tool The tool to draw; its kind and diameter decide the shape.
 * @returns Points ordered from the tip outward and upward, in mm.
 */
export function toolProfile(tool: CncTool): ReadonlyArray<ToolProfilePoint> {
  const radiusMm = Math.max(MIN_RADIUS_MM, tool.diameterMm / 2);
  const points: ToolProfilePoint[] = [];

  for (let sample = 0; sample <= CUTTING_SURFACE_SAMPLES; sample += 1) {
    const dMm = sampleRadiusMm(radiusMm, sample, CUTTING_SURFACE_SAMPLES);
    points.push({ radiusMm: dMm, heightMm: cuttingSurfaceDz(tool, dMm, radiusMm) });
  }

  // The shank continues straight up from the outer edge of the cutting
  // surface, so the last cutting sample sets where it starts.
  const shoulder = points[points.length - 1];
  points.push({
    radiusMm,
    heightMm: (shoulder?.heightMm ?? 0) + tool.diameterMm * SHANK_LENGTH_DIAMETERS,
  });

  return points;
}
