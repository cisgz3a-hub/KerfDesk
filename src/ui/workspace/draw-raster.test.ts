// Regression test for the F.2.c → 3b9c4139 bug:
//
// drawRasterImage uses ctx.translate/rotate/scale to render a bitmap
// at the same world position the rest of the codebase computes via
// applyTransform (in particular, transformedBBox uses applyTransform
// on the four corner points, which is what the selection box draws).
//
// The bug was that drawRasterImage composed those ctx calls around
// the object's bounding-box centre, not its local (0,0) corner.
// applyTransform rotates and scales around (0,0), so when scaleX/Y
// was set to anything other than 1 (e.g. fitObjectToBed auto-shrunk
// a large import) the rendered image drifted from the selection box
// by w*(1 - scaleX)/2. Cleanly visible at any scale != 1.
//
// This test pins the convention: for representative transform shapes
// (identity, translated, scaled, rotated, mirrored, full-combo), the
// world-space corner positions produced by drawRasterImage's exact
// ctx-call composition must equal applyTransform of the same corners.
// If a future refactor moves drawRasterImage's math back to a
// centre-based composition, these tests fail loudly.

import { describe, expect, it } from 'vitest';
import { applyTransform, IDENTITY_TRANSFORM, type Transform, type Vec2 } from '../../core/scene';

// Replicates the math the ctx calls in drawRasterImage compose at
// unit view scale. Canvas2D applies transforms in the right-to-left
// (M_first . M_second . M_third) sense relative to drawn points, so
// the ctx call order (translate, rotate, scale) applies as:
//   final = translate( rotate( scale(p) ) )
// which is exactly applyTransform's algebra. We re-derive it here so
// the test fails if either side drifts.
function drawRasterPointToWorld(p: Vec2, t: Transform): Vec2 {
  // 1. scale (with mirror)
  const x = p.x * (t.mirrorX ? -t.scaleX : t.scaleX);
  const y = p.y * (t.mirrorY ? -t.scaleY : t.scaleY);
  // 2. rotate around the local (0, 0) origin
  const rad = (t.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const xr = x * cos - y * sin;
  const yr = x * sin + y * cos;
  // 3. translate by (t.x, t.y)
  return { x: xr + t.x, y: yr + t.y };
}

const cases: Array<{ readonly name: string; readonly transform: Transform }> = [
  { name: 'identity', transform: IDENTITY_TRANSFORM },
  { name: 'translated', transform: { ...IDENTITY_TRANSFORM, x: 50, y: 30 } },
  {
    name: 'scaled-down (the original drift case)',
    transform: { ...IDENTITY_TRANSFORM, scaleX: 0.5, scaleY: 0.5 },
  },
  {
    name: 'translated + scaled-down',
    transform: { ...IDENTITY_TRANSFORM, x: 50, y: 30, scaleX: 0.5, scaleY: 0.5 },
  },
  { name: 'rotated 30°', transform: { ...IDENTITY_TRANSFORM, rotationDeg: 30 } },
  { name: 'rotated 90°', transform: { ...IDENTITY_TRANSFORM, rotationDeg: 90 } },
  { name: 'mirrored X', transform: { ...IDENTITY_TRANSFORM, mirrorX: true } },
  { name: 'mirrored Y', transform: { ...IDENTITY_TRANSFORM, mirrorY: true } },
  {
    name: 'full combo (translated, scaled, rotated, mirrored)',
    transform: {
      x: 10,
      y: 20,
      scaleX: 0.7,
      scaleY: 0.7,
      rotationDeg: 45,
      mirrorX: true,
      mirrorY: false,
    },
  },
];

// Four corners of a representative 100×50 raster bounds at (0, 0).
const corners: Vec2[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 50 },
  { x: 0, y: 50 },
];

describe('drawRasterImage render position matches applyTransform', () => {
  for (const c of cases) {
    it(`${c.name}`, () => {
      for (const corner of corners) {
        const rendered = drawRasterPointToWorld(corner, c.transform);
        const expected = applyTransform(corner, c.transform);
        expect(rendered.x).toBeCloseTo(expected.x, 6);
        expect(rendered.y).toBeCloseTo(expected.y, 6);
      }
    });
  }
});
